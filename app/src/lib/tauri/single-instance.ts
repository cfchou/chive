export function pdfPathsFromArgs(args: readonly string[]): string[] {
  return args.filter((arg) => arg.toLowerCase().endsWith(".pdf"));
}
