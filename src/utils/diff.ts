export interface DiffSegment {
  text: string;
  type: "equal" | "removed" | "added";
}

/**
 * Compute a lightweight word-level LCS diff between original and corrected text
 * so changes are highlighted clearly side-by-side.
 */
export function computeWordDiff(
  original: string,
  corrected: string
): { originalSegments: DiffSegment[]; correctedSegments: DiffSegment[] } {
  const origTokens = original.split(/(\s+)/).filter((t) => t.length > 0);
  const corrTokens = corrected.split(/(\s+)/).filter((t) => t.length > 0);

  const m = origTokens.length;
  const n = corrTokens.length;

  // Guard against extremely long texts for O(m*n) memory
  if (m * n > 250000) {
    return {
      originalSegments: [{ text: original, type: "equal" }],
      correctedSegments: [{ text: corrected, type: "equal" }],
    };
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (origTokens[i] === corrTokens[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const originalSegments: DiffSegment[] = [];
  const correctedSegments: DiffSegment[] = [];

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (origTokens[i] === corrTokens[j]) {
      originalSegments.push({ text: origTokens[i], type: "equal" });
      correctedSegments.push({ text: corrTokens[j], type: "equal" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      originalSegments.push({ text: origTokens[i], type: "removed" });
      i++;
    } else {
      correctedSegments.push({ text: corrTokens[j], type: "added" });
      j++;
    }
  }

  while (i < m) {
    originalSegments.push({ text: origTokens[i], type: "removed" });
    i++;
  }
  while (j < n) {
    correctedSegments.push({ text: corrTokens[j], type: "added" });
    j++;
  }

  return { originalSegments, correctedSegments };
}
