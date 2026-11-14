import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import * as cheerio from "cheerio";
import { GoogleGenAI } from "@google/genai";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";
import { detectContentLanguage, isGeminiConfigured } from "./analyzer.ts";

export type IngestSourceType = "text" | "url" | "pdf" | "image";

export interface IngestResult {
  success: true;
  source_type: IngestSourceType;
  source_name: string;
  title?: string;
  detected_language: string;
  extracted_text: string;
  message: string;
  extraction_method?: string;
}

export class IngestionError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "IngestionError";
    this.statusCode = statusCode;
  }
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_HTML_BYTES = 3 * 1024 * 1024; // 3 MB
const MAX_EXTRACTED_CHARS = 30000;
const FETCH_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata.goog",
  "169.254.169.254",
]);

function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 ("this network")
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 & 192.0.2.0/24 reserved
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateOrReservedIP(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase();
  const zoneIdx = ip.indexOf("%");
  const cleanIp = zoneIdx >= 0 ? ip.slice(0, zoneIdx) : ip;

  if (net.isIPv4(cleanIp)) {
    return isPrivateOrReservedIPv4(cleanIp);
  }
  if (net.isIPv6(cleanIp)) {
    if (cleanIp === "::" || cleanIp === "::1") return true;
    if (cleanIp.startsWith("::ffff:")) {
      const mapped = cleanIp.slice(7);
      if (net.isIPv4(mapped)) return isPrivateOrReservedIPv4(mapped);
      return true;
    }
    // Unique local fc00::/7 (fc.. or fd..) and link-local fe80::/10 (fe8..fe9..fea..feb..)
    if (cleanIp.startsWith("fc") || cleanIp.startsWith("fd")) return true;
    if (/^fe[89ab]/i.test(cleanIp)) return true;
    if (cleanIp.startsWith("ff")) return true; // multicast
    return false;
  }
  return true;
}

async function assertPublicSafeUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new IngestionError("Invalid URL format. Please enter a valid http:// or https:// webpage URL.", 400);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new IngestionError("Only http:// and https:// URLs are supported.", 400);
  }

  if (parsed.username || parsed.password) {
    throw new IngestionError("URLs with embedded credentials are not allowed.", 400);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) {
    throw new IngestionError("Invalid URL hostname.", 400);
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home")
  ) {
    throw new IngestionError("Access to localhost and internal network addresses is blocked for security.", 400);
  }

  const unbracketedHost = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  if (net.isIP(unbracketedHost)) {
    if (isPrivateOrReservedIP(unbracketedHost)) {
      throw new IngestionError("Access to private, loopback, or internal IP addresses is blocked.", 400);
    }
    return parsed;
  }

  // Block integer/hex/octal obfuscated IP hostnames
  if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) {
    throw new IngestionError("Numeric or obfuscated IP hostnames are not permitted.", 400);
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await dns.lookup(hostname, { all: true });
  } catch {
    throw new IngestionError(`Could not resolve domain "${hostname}". Please check the URL and try again.`, 422);
  }

  if (!resolved || resolved.length === 0) {
    throw new IngestionError(`Domain "${hostname}" did not resolve to any public IP address.`, 422);
  }

  for (const record of resolved) {
    if (isPrivateOrReservedIP(record.address)) {
      throw new IngestionError("Access to private or internal network addresses is blocked.", 400);
    }
  }

  return parsed;
}

function normalizeExtractedText(text: string): string {
  const normalized = text
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized.length > MAX_EXTRACTED_CHARS
    ? normalized.slice(0, MAX_EXTRACTED_CHARS).trim()
    : normalized;
}

export function ingestDirectText(rawText: string, sourceName = "Direct Text Input"): IngestResult {
  const cleaned = normalizeExtractedText(rawText);
  if (!cleaned) {
    throw new IngestionError("Please enter or paste text content before submitting.", 400);
  }
  if (cleaned.length < 5) {
    throw new IngestionError("Submitted text is too short (minimum 5 characters).", 400);
  }

  const detected_language = detectContentLanguage(cleaned);
  return {
    success: true,
    source_type: "text",
    source_name: sourceName,
    detected_language,
    extracted_text: cleaned,
    message: "Text content prepared successfully",
    extraction_method: "direct_text",
  };
}

function extractReadableHtml(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);

  const title = (
    $("meta[property='og:title']").attr("content") ||
    $("title").first().text() ||
    $("h1").first().text() ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();

  // Strip scripts, styles, navigation, ads, popups, and structural boilerplate
  $(
    [
      "script",
      "style",
      "noscript",
      "iframe",
      "object",
      "embed",
      "svg",
      "canvas",
      "template",
      "nav",
      "header",
      "footer",
      "aside",
      "form",
      "button",
      "input",
      "select",
      "textarea",
      "[role='navigation']",
      "[role='banner']",
      "[role='contentinfo']",
      "[role='complementary']",
      "[aria-hidden='true']",
      ".advertisement",
      ".advert",
      ".ad-banner",
      ".ad-container",
      ".ads",
      ".cookie-banner",
      ".cookie-consent",
      ".newsletter-popup",
      ".sidebar",
      ".breadcrumb",
      ".breadcrumbs",
      "#cookie-banner",
      "#sidebar",
      "#nav",
      "#navbar",
      "#footer",
      "#header",
    ].join(", ")
  ).remove();

  // Remove any element whose class or id clearly indicates ads or navigation
  $("[class], [id]").each((_idx, el) => {
    const className = ($(el).attr("class") || "").toLowerCase();
    const idName = ($(el).attr("id") || "").toLowerCase();
    const combined = `${className} ${idName}`;
    if (/(?:^|\s|[-_])(ad|ads|advert|advertisement|sponsor|promo-bar|cookie|popup|modal|navbar|menu-bar|social-share)(?:$|\s|[-_])/.test(combined)) {
      if (el.tagName !== "body" && el.tagName !== "main" && el.tagName !== "article") {
        $(el).remove();
      }
    }
  });

  const mainSelectors = [
    "article",
    "main",
    "[role='main']",
    ".article-body",
    ".post-content",
    ".entry-content",
    ".main-content",
    "#main-content",
    "#content",
    "body",
  ];

  let root: ReturnType<typeof $> = $("body");
  for (const selector of mainSelectors) {
    const candidate = $(selector).first();
    if (candidate.length > 0 && candidate.text().trim().length >= 60) {
      root = candidate;
      break;
    }
  }

  const blocks: string[] = [];
  const seen = new Set<string>();

  root.find("h1, h2, h3, h4, h5, h6, p, li, blockquote").each((_idx, el) => {
    // Skip nested blocks whose parent paragraph/blockquote is also selected
    if ($(el).parents("p, blockquote").length > 0) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text || text.length < 3) return;
    if (!seen.has(text)) {
      seen.add(text);
      blocks.push(text);
    }
  });

  const extracted =
    blocks.length > 0
      ? blocks.join("\n\n")
      : root.text().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  return {
    title,
    text: normalizeExtractedText(extracted),
  };
}

export async function ingestWebsiteUrl(rawUrl: string): Promise<IngestResult> {
  let currentUrl = await assertPublicSafeUrl(rawUrl);

  let response: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      response = await fetch(currentUrl.toString(), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": "BrandLens-ContentChecker/1.0 (+https://brandlens.local)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          "Accept-Language": "en,hi,bn;q=0.9",
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      if (msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout")) {
        throw new IngestionError("The webpage took too long to respond. Please check the URL or paste the text directly.", 422);
      }
      throw new IngestionError(`Unable to fetch the webpage (${msg}).`, 422);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new IngestionError("Webpage returned an incomplete redirect.", 422);
      }
      if (hop === MAX_REDIRECTS) {
        throw new IngestionError("Webpage exceeded maximum redirect limit.", 422);
      }
      const nextUrl = new URL(location, currentUrl);
      currentUrl = await assertPublicSafeUrl(nextUrl.toString());
      continue;
    }
    break;
  }

  if (!response) {
    throw new IngestionError("Failed to retrieve webpage.", 422);
  }

  if (!response.ok) {
    throw new IngestionError(
      `Unable to access webpage (HTTP ${response.status} ${response.statusText || ""}). Some sites block automated readers—try pasting the text directly.`.trim(),
      422
    );
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml") &&
    !contentType.includes("text/plain")
  ) {
    throw new IngestionError(
      `Unsupported URL content type "${contentType.split(";")[0]}". Provide a webpage URL or upload PDF/image files directly.`,
      400
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new IngestionError("The webpage returned an empty response.", 422);
  }
  if (buffer.byteLength > MAX_HTML_BYTES) {
    throw new IngestionError("Webpage HTML exceeds the 3 MB extraction limit.", 422);
  }

  const rawBody = buffer.toString("utf8");
  let pageTitle = currentUrl.hostname;
  let extractedText = "";

  if (contentType.includes("text/plain")) {
    extractedText = normalizeExtractedText(rawBody);
  } else {
    const parsed = extractReadableHtml(rawBody);
    if (parsed.title) pageTitle = parsed.title;
    extractedText = parsed.text;
  }

  if (!extractedText || extractedText.length < 15) {
    throw new IngestionError(
      "No readable text content could be extracted from this webpage (it may require JavaScript rendering or login).",
      422
    );
  }

  const detected_language = detectContentLanguage(extractedText);
  return {
    success: true,
    source_type: "url",
    source_name: currentUrl.toString(),
    title: pageTitle,
    detected_language,
    extracted_text: extractedText,
    message: "Webpage content extracted successfully",
    extraction_method: "cheerio_html",
  };
}

function getGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function extractTextWithGeminiMultimodal(
  buffer: Buffer,
  mimeType: "application/pdf" | "image/png" | "image/jpeg"
): Promise<string> {
  const ai = getGeminiClient();
  const prompt =
    mimeType === "application/pdf"
      ? `Extract ALL readable text from this PDF document verbatim in its original language and script (English, Hindi/Devanagari, Bengali, or mixed-language).
Rules:
- Preserve exact words, spelling, punctuation, numbers, and paragraph breaks.
- Do NOT translate Hindi or Bengali into English or vice versa.
- Do NOT summarize, correct grammar, or add commentary.
- If the PDF contains no readable text at all, return exactly: NO_READABLE_TEXT`
      : `Extract ALL visible text from this image verbatim in its original language and script (English, Hindi/Devanagari, Bengali, or mixed-language).
Rules:
- Preserve exact words, spelling, punctuation, numbers, and line breaks.
- Do NOT translate Hindi or Bengali into English or vice versa.
- Do NOT summarize, fix brand violations, or add commentary.
- If there is no readable text in the image, return exactly: NO_READABLE_TEXT`;

  const response = await ai.models.generateContent({
    model: "gemini-4-hydrogen",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType,
            data: buffer.toString("base64"),
          },
        },
        { text: prompt },
      ],
    },
  });

  const text = (response.text ?? "").trim();
  if (!text || text === "NO_READABLE_TEXT") {
    return "";
  }
  return normalizeExtractedText(text);
}

async function extractTextFromPdfBuffer(buffer: Buffer): Promise<{
  text: string;
  method: string;
}> {
  // Check PDF signature
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new IngestionError("The uploaded file does not appear to be a valid PDF document.", 400);
  }

  let embeddedText = "";
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    });
    const pdfDoc = await loadingTask.promise;
    const pageTexts: string[] = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const lines: string[] = [];
      let currentLine = "";
      let lastY: number | null = null;

      for (const rawItem of textContent.items) {
        if (!("str" in rawItem)) continue;
        const item = rawItem as { str: string; hasEOL?: boolean; transform?: number[] };
        const y = Array.isArray(item.transform) ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 4 && currentLine.trim()) {
          lines.push(currentLine.trim());
          currentLine = "";
        }
        currentLine += item.str;
        if (item.hasEOL) {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = "";
        }
        if (y !== null) lastY = y;
      }
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
      }
      const joined = lines.join("\n").trim();
      if (joined) pageTexts.push(joined);
    }

    embeddedText = normalizeExtractedText(pageTexts.join("\n\n"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "PDF parse error";
    throw new IngestionError(`Failed to read PDF file (${msg}). Ensure the PDF is not password-protected or corrupted.`, 422);
  }

  // If readable Unicode text was extracted directly, return immediately
  const readableChars = embeddedText.replace(/\s+/g, "");
  if (readableChars.length >= 15) {
    return { text: embeddedText, method: "pdfjs_unicode" };
  }

  // Otherwise treat as scanned/image-based PDF and attempt OCR via Gemini multimodal
  if (isGeminiConfigured()) {
    try {
      const ocrText = await extractTextWithGeminiMultimodal(buffer, "application/pdf");
      if (ocrText && ocrText.replace(/\s+/g, "").length >= 5) {
        return { text: ocrText, method: "gemini_pdf_ocr" };
      }
    } catch (err) {
      console.warn("Gemini scanned-PDF OCR fallback failed:", err);
    }
  }

  if (readableChars.length > 0) {
    return { text: embeddedText, method: "pdfjs_unicode" };
  }

  throw new IngestionError(
    "No readable embedded text was found in this PDF. It appears to be a scanned/image-only PDF and OCR extraction requires a configured Gemini API key.",
    422
  );
}

async function runTesseractFallback(buffer: Buffer): Promise<string> {
  const cacheDir = path.join(os.tmpdir(), "brandlens-tessdata");
  await fs.mkdir(cacheDir, { recursive: true });

  // Attempt multilingual worker (eng+hin+ben); fall back to eng if offline
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  try {
    try {
      worker = await createWorker(["eng", "hin", "ben"], 1, {
        cachePath: cacheDir,
        logger: () => {},
      });
    } catch {
      worker = await createWorker("eng", 1, {
        cachePath: cacheDir,
        logger: () => {},
      });
    }
    const { data } = await worker.recognize(buffer);
    return normalizeExtractedText(data?.text || "");
  } finally {
    if (worker) {
      await worker.terminate().catch(() => {});
    }
  }
}

async function extractTextFromImageBuffer(
  buffer: Buffer,
  mimeType: "image/png" | "image/jpeg"
): Promise<{ text: string; method: string }> {
  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  const isJpeg =
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;

  if (!isPng && !isJpeg) {
    throw new IngestionError("The uploaded file is not a valid PNG or JPG/JPEG image.", 400);
  }

  const normalizedMime: "image/png" | "image/jpeg" = isPng ? "image/png" : "image/jpeg";

  if (isGeminiConfigured()) {
    try {
      const geminiText = await extractTextWithGeminiMultimodal(buffer, normalizedMime);
      if (geminiText) {
        return { text: geminiText, method: "gemini_vision_ocr" };
      }
      throw new IngestionError(
        "No readable text was detected in this image. Please upload an image containing clear English, Hindi, or Bengali text.",
        422
      );
    } catch (err) {
      if (err instanceof IngestionError) throw err;
      console.warn("Gemini image OCR failed, falling back to Tesseract:", err);
    }
  }

  // Local Tesseract.js OCR fallback
  try {
    const tessText = await runTesseractFallback(buffer);
    if (!tessText || tessText.replace(/\s+/g, "").length < 3) {
      throw new IngestionError(
        "No readable text was detected in this image. Please upload a clearer image with legible English, Hindi, or Bengali text.",
        422
      );
    }
    return { text: tessText, method: "tesseract_ocr" };
  } catch (err) {
    if (err instanceof IngestionError) throw err;
    throw new IngestionError(
      "Image OCR could not extract readable text in the current offline environment. Please verify the image contains clear text or configure GEMINI_API_KEY for multilingual vision OCR.",
      422
    );
  }
}

export async function ingestUploadedFile(params: {
  filePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  requestedSourceType?: string;
}): Promise<IngestResult> {
  const { filePath, originalName, mimeType, size, requestedSourceType } = params;

  if (!size || size <= 0) {
    throw new IngestionError("The uploaded file is empty (0 bytes).", 400);
  }
  if (size > MAX_UPLOAD_BYTES) {
    throw new IngestionError("File size exceeds the 10 MB limit.", 400);
  }

  const ext = path.extname(originalName).toLowerCase();
  const mimeLower = (mimeType || "").toLowerCase();

  const isPdf = ext === ".pdf" || mimeLower === "application/pdf";
  const isPng = ext === ".png" || mimeLower === "image/png";
  const isJpg = ext === ".jpg" || ext === ".jpeg" || mimeLower === "image/jpeg" || mimeLower === "image/jpg";

  if (!isPdf && !isPng && !isJpg) {
    throw new IngestionError(
      `Unsupported file format "${ext || mimeType || "unknown"}". Please upload a PDF, PNG, JPG, or JPEG file.`,
      400
    );
  }

  if (requestedSourceType === "pdf" && !isPdf) {
    throw new IngestionError("Please upload a valid .pdf file for PDF ingestion.", 400);
  }
  if (requestedSourceType === "image" && !isPng && !isJpg) {
    throw new IngestionError("Please upload a PNG, JPG, or JPEG image file.", 400);
  }

  const buffer = await fs.readFile(filePath);
  if (buffer.byteLength === 0) {
    throw new IngestionError("The uploaded file is empty.", 400);
  }

  const stem = path.basename(originalName, path.extname(originalName)).trim() || originalName;

  if (isPdf) {
    const { text, method } = await extractTextFromPdfBuffer(buffer);
    const detected_language = detectContentLanguage(text);
    return {
      success: true,
      source_type: "pdf",
      source_name: originalName,
      title: stem,
      detected_language,
      extracted_text: text,
      message: "Content extracted successfully",
      extraction_method: method,
    };
  }

  const { text, method } = await extractTextFromImageBuffer(
    buffer,
    isPng ? "image/png" : "image/jpeg"
  );
  const detected_language = detectContentLanguage(text);
  return {
    success: true,
    source_type: "image",
    source_name: originalName,
    title: stem,
    detected_language,
    extracted_text: text,
    message: "Content extracted successfully",
    extraction_method: method,
  };
}
