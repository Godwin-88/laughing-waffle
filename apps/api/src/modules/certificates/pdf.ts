import PDFDocument from "pdfkit";
import { loadEnv } from "../../config/env";

export interface CertificatePdfData {
  learnerName: string;
  courseTitle: string;
  instructorName: string;
  certificateNumber: string;
  completionDate: string; // ISO
  issuedBy: string; // platform name
}

const INK = "#1e293b";
const ACCENT = "#0f766e";
const GOLD = "#b45309";

/**
 * Server-side certificate PDF (US-5.1.2) — learner name, course title,
 * completion date, unique certificate id, instructor name and platform logo
 * (rendered brand lock-up — no external asset required).
 */
export async function buildCertificatePdf(input: CertificatePdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "letter", layout: "landscape", margin: 0, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const W = 792;
  const H = 612;

  // Outer border
  doc.rect(18, 18, W - 36, H - 36).lineWidth(2).stroke(ACCENT);
  doc.rect(26, 26, W - 52, H - 52).lineWidth(0.75).stroke(GOLD);

  // Brand lock-up ("logo") at top-centre
  doc.roundedRect(W / 2 - 70, 52, 140, 40, 8).fill(ACCENT);
  doc
    .fillColor("white")
    .fontSize(19)
    .font("Helvetica-Bold")
    .text(input.issuedBy, W / 2 - 64, 63, { width: 128, align: "center" });

  doc
    .fillColor(INK)
    .fontSize(30)
    .font("Helvetica-Bold")
    .text("CERTIFICATE OF COMPLETION", 0, 108, { width: W, align: "center" });

  doc
    .fillColor("#475569")
    .fontSize(13)
    .font("Helvetica")
    .text("This is to certify that", 0, 150, { width: W, align: "center" });

  doc
    .fillColor(INK)
    .fontSize(34)
    .font("Helvetica-Bold")
    .text(input.learnerName, 0, 176, { width: W, align: "center" });

  doc
    .fillColor("#475569")
    .fontSize(13)
    .font("Helvetica")
    .text("has successfully completed the programme", 0, 228, { width: W, align: "center" });

  doc
    .fillColor(ACCENT)
    .fontSize(23)
    .font("Helvetica-Bold")
    .text(input.courseTitle, 40, 252, { width: W - 80, align: "center" });

  if (input.instructorName) {
    doc
      .fillColor("#475569")
      .fontSize(12)
      .font("Helvetica")
      .text(`Course instructor · ${input.instructorName}`, 0, 300, { width: W, align: "center" });
  }

  const completion = new Date(input.completionDate);
  const formatted = completion.toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" });

  // Date + certificate id at the bottom
  doc
    .fillColor(INK)
    .fontSize(12)
    .font("Helvetica-Bold")
    .text(`Date of completion — ${formatted}`, 0, 380, { width: W / 2, align: "center" })
    .text(`Certificate ID — ${input.certificateNumber}`, W / 2, 380, { width: W / 2, align: "center" });

  const env = loadEnv();
  const verifyUrl = `${env.WEB_ORIGIN ?? "https://platform.takwimu.school"}/verify/${input.certificateNumber}`;
  doc
    .fillColor("#64748b")
    .fontSize(9)
    .font("Helvetica")
    .text(`Verify this certificate at ${verifyUrl}`, 0, 428, { width: W, align: "center" });

  doc
    .fillColor("#94a3b8")
    .fontSize(8)
    .font("Helvetica")
    .text("Takwimu Data School", 0, H - 34, { width: W, align: "center", characterSpacing: 2 });

  doc.end();
  return done;
}

export async function certificateKeyFor(userId: string, certificateNumber: string): Promise<string> {
  // Deterministic per certificate — stored in the user-uploads bucket.
  return `certificates/${userId}/${certificateNumber}.pdf`;
}