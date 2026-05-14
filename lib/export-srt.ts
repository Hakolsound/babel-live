export interface TranscriptEntry {
  language_code: string;
  text: string;
  timestamp_ms: number;
}

function msToSrtTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const milliseconds = ms % 1000;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

export function generateSRT(entries: TranscriptEntry[], targetLang: string): string {
  const filtered = entries
    .filter((e) => e.language_code === targetLang)
    .sort((a, b) => a.timestamp_ms - b.timestamp_ms);

  if (filtered.length === 0) return "";

  const blocks: string[] = [];

  for (let i = 0; i < filtered.length; i++) {
    const current = filtered[i]!;
    const next = filtered[i + 1];
    const duration = next
      ? Math.min(next.timestamp_ms - current.timestamp_ms, 5000)
      : 3000;

    const start = msToSrtTime(current.timestamp_ms);
    const end = msToSrtTime(current.timestamp_ms + duration);

    blocks.push(`${i + 1}\n${start} --> ${end}\n${current.text}\n`);
  }

  return blocks.join("\n");
}

export function downloadSRT(entries: TranscriptEntry[], lang: string, eventTitle: string): void {
  const srt = generateSRT(entries, lang);
  if (!srt) return;

  const safeName = eventTitle.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const filename = `babel-${lang}-${safeName}.srt`;

  const blob = new Blob([srt], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadAllSRT(entries: TranscriptEntry[], langs: string[], eventTitle: string): void {
  for (const lang of langs) {
    downloadSRT(entries, lang, eventTitle);
  }
}
