export declare const PERSONAL_DATA_PLACEHOLDERS: Readonly<{ contact: string; number: string; address: string }>;
export declare function maskPersonalData(text: string, options?: { readonly urls?: boolean }): string;
