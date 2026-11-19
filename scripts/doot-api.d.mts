export type ApiOptions = {
  method: string;
  path: string;
  wait: boolean;
  timeout: number;
  dataFile?: string;
};
export function parseArguments(args: string[]): ApiOptions;
export function runApi(
  options: ApiOptions,
  dependencies?: {
    fetch?: typeof fetch;
    sleep?: (milliseconds: number) => unknown;
    base?: string;
    readFile?: (path: string, encoding: string) => Promise<string>;
    readStdin?: () => Promise<string>;
  },
): Promise<any>;
