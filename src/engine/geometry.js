// Pure (DOM-free) watermark geometry. Shared by the browser image engine and
// the Cloudflare Worker MCP server.
//
// Gemini places the visible sparkle watermark in the bottom-right corner:
//   - 96px logo with a 64px margin for images larger than 1024×1024
//   - 48px logo with a 32px margin otherwise
export function getWatermarkInfo(width, height) {
    const isLarge = width > 1024 && height > 1024;
    const size = isLarge ? 96 : 48;
    const margin = isLarge ? 64 : 32;

    return {
        size,
        x: width - margin - size,
        y: height - margin - size,
        width: size,
        height: size,
    };
}
