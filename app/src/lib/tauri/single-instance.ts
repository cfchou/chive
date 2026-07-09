export const SECOND_INSTANCE_EVENT = "chive://second-instance";

export type SecondInstancePayload = {
  args?: string[];
};

export function pdfPathsFromSecondInstanceArgs(args: readonly string[] = []) {
  return args.filter((arg) => arg.toLowerCase().endsWith(".pdf"));
}
