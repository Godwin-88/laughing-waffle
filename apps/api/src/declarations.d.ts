/**
 * Minimal type surface for `archiver` (ZIP archiver used by GDPR exports,
 * US-7.2.1). The package ships no TypeScript types; keep the surface tight
 * to the API the GDPR module actually uses.
 */
declare module "archiver" {
  interface ArchiverWarning {
    message: string;
  }

  interface Archiver {
    on(event: "data", cb: (chunk: Buffer) => void): void;
    on(event: "warning", cb: (err: ArchiverWarning) => void): void;
    on(event: "error", cb: (err: Error) => void): void;
    on(event: "end", cb: () => void): void;
    append(data: Buffer | string, opts: { name: string }): void;
    finalize(): Promise<void>;
  }

  interface ArchiverOptions {
    zlib?: { level: number };
  }

  export default function archiver(format: "zip", opts?: ArchiverOptions): Archiver;
}