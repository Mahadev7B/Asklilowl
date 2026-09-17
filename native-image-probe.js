import { randomUUID } from "node:crypto";
import { z } from "zod";

// Temporary diagnostic: the documented ChatGPT file input shape is deliberately
// separate from lesson URL candidates. No lesson/audio service is called here.
export function registerNativeImageProbe(server, { imageService, logger }) {
  server.registerTool("probe_native_image", {
    title: "Test one native image handoff",
    description: "Diagnostic only, when explicitly requested: pass exactly one image generated natively in this ChatGPT conversation. Use the real generated file, never invent a file ID or download URL and never substitute a web image. This verifies receipt and downloads the image without creating a lesson, narration, or invoking any paid API.",
    inputSchema: {
      image: z.object({
        download_url: z.string(),
        file_id: z.string(),
        mime_type: z.string().optional(),
        file_name: z.string().optional(),
      }).strict(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: { "openai/fileParams": ["image"] },
  }, async ({ image }) => {
    const probeId = randomUUID();
    let origin = null;
    try { origin = new URL(image.download_url).origin; } catch {}
    logger.info?.({ event: "native_image_probe_received", probeId,
      fields: Object.fromEntries(Object.entries(image).map(([key, value]) => [key, typeof value])),
      hasFileId: Boolean(image.file_id.trim()), hasDownloadUrl: Boolean(image.download_url.trim()), origin });
    try {
      if (!image.file_id.trim() || !image.download_url.trim()) throw new Error("empty_reference");
      const [prepared] = await imageService.prepareMany([image]);
      const id = new URL(prepared.download_url).pathname.split("/").pop();
      const asset = imageService.resolve(id);
      if (!asset?.bytes?.length) throw new Error("no_image_bytes");
      const result = { event: "native_image_probe_downloaded", probeId, bytes: asset.bytes.length, mimeType: asset.contentType };
      logger.info?.(result);
      return { content: [
        { type: "text", text: JSON.stringify(result) },
        { type: "image", data: Buffer.from(asset.bytes).toString("base64"), mimeType: asset.contentType },
      ] };
    } catch {
      // Exceptions from network clients can contain signed URLs. Never log them.
      const result = { event: "native_image_probe_download_failed", probeId, received: true };
      logger.info?.(result);
      return { isError: true, content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  });
}
