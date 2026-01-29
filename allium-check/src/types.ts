// Source location for error reporting
export type Loc = {
  line: number;
  col: number;
};

// Diagnostic (error/warning) output
export type Diagnostic = {
  file: string;
  line: number;
  col: number;
  message: string;
  suggestion?: string;
};
