import sharp from "sharp";
export async function normalizeAvatar(value) {
  if (value === "") return "";
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error("Choose a PNG, JPEG or WebP image.");
  const input = Buffer.from(match[2], "base64");
  if (input.length > 600000)
    throw new Error("The profile image must be smaller than 600 KB.");
  const image = sharp(input, { limitInputPixels: 16000000, animated: false });
  const metadata = await image.metadata();
  if (!["png", "jpeg", "webp"].includes(metadata.format))
    throw new Error("Unsupported image format.");
  // Decode and re-encode: no SVG, scripts, EXIF metadata or original file payload.
  const bytes = await image
    .rotate()
    .resize(256, 256, { fit: "cover" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
