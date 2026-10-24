/** Limited, length-preserving search folding; not general Unicode NFKC. */
export function normalizeSearchText(text: string): string {
    return text
        .replace(/[\uFF01-\uFF5E]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
        .replace(/\u3000/g, ' ')
        .replace(/[A-Z]/g, char => char.toLowerCase());
}
