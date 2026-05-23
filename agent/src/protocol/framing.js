export function encodeLineDelimitedJson(message) {
  return `${JSON.stringify(message)}\n`;
}

function parseEmbeddedJson(line) {
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character !== "{" && character !== "[") {
      continue;
    }

    try {
      return JSON.parse(line.slice(index));
    } catch {
      continue;
    }
  }

  return null;
}

export function decodeJsonLines(rawText) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parsed = parseEmbeddedJson(line);
      return parsed ? [parsed] : [];
    });
}
