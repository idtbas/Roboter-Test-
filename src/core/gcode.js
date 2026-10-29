// G-code line parser shared by the FDM firmware and the GRBL emulation.
// Returns null for empty lines. Otherwise:
//   { letter: 'G', num: 1, code: 'G1', params: { X: 10, Y: 2 }, text, comment, raw }

const TEXT_COMMANDS = new Set(['M117', 'M118', 'M0', 'M1', 'M23', 'M28', 'M30', 'M32', 'M851']);

export function parseGcodeLine(raw) {
  let line = raw;
  let comment = '';
  // strip comments (respecting quoted strings)
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (!inQ && c === ';') {
      comment = line.slice(i + 1).trim();
      line = line.slice(0, i);
      break;
    } else if (!inQ && c === '(') {
      const end = line.indexOf(')', i);
      if (end >= 0) {
        comment = line.slice(i + 1, end).trim();
        line = line.slice(0, i) + ' ' + line.slice(end + 1);
        i--;
      }
    }
  }
  line = line.trim();
  if (!line) return comment ? { code: null, comment, raw, params: {} } : null;
  // strip line number and checksum
  if (line[0] === 'N' || line[0] === 'n') {
    const m = line.match(/^[Nn]\d+\s*/);
    if (m) line = line.slice(m[0].length);
  }
  const star = line.lastIndexOf('*');
  if (star > 0 && /^\*\d+$/.test(line.slice(star))) line = line.slice(0, star).trim();
  if (!line) return null;

  const head = line.match(/^([A-Za-z])\s*(-?\d+(?:\.\d+)?)/);
  if (!head) {
    // GRBL style "$..." or unknown
    return { code: line, letter: line[0], num: NaN, params: {}, text: line, comment, raw };
  }
  const letter = head[1].toUpperCase();
  const numStr = head[2];
  const num = parseFloat(numStr);
  const code = letter + numStr.replace(/^(-?)0+(\d)/, '$1$2');
  const rest = line.slice(head[0].length);
  const params = {};
  if (TEXT_COMMANDS.has(code)) {
    return { code, letter, num, params, text: rest.trim(), comment, raw };
  }
  const re = /([A-Za-z])\s*(?:"([^"]*)"|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?))?/g;
  let m;
  while ((m = re.exec(rest))) {
    const k = m[1].toUpperCase();
    if (m[2] !== undefined) params[k] = m[2];
    else if (m[3] !== undefined) params[k] = parseFloat(m[3]);
    else params[k] = true;
  }
  return { code, letter, num, params, text: rest.trim(), comment, raw };
}

// Split text into lines lazily (keeps memory low for big files)
export class LineReader {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.lineNo = 0;
  }

  get done() {
    return this.pos >= this.text.length;
  }

  get progress() {
    return this.text.length ? this.pos / this.text.length : 1;
  }

  next() {
    if (this.pos >= this.text.length) return null;
    let end = this.text.indexOf('\n', this.pos);
    if (end < 0) end = this.text.length;
    let line = this.text.slice(this.pos, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    this.pos = end + 1;
    this.lineNo++;
    return line;
  }
}
