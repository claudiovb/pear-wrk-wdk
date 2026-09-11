/**
 * Validate that a value is a non-empty string
 * @param value - Value to validate
 * @param fieldName - Name of the field for error messages
 * @throws {Error} If validation fails
 */
export function validateNonEmptyString(value: any, fieldName: string): void;

/**
 * Validate that a value is a non-negative integer
 * @param value - Value to validate
 * @param fieldName - Name of the field for error messages
 * @throws {Error} If validation fails
 */
export function validateNonNegativeInteger(value: any, fieldName: string): void;

/**
 * Validate that a value is one of the allowed values
 * @param value - Value to validate
 * @param allowedValues - Array of allowed values
 * @param fieldName - Name of the field for error messages
 * @throws {Error} If validation fails
 */
export function validateEnum(value: any, allowedValues: any[], fieldName: string): void;

/**
 * Validate that a value is a non-empty Buffer
 * @param value - Value to validate
 * @param fieldName - Name of the field for error messages
 * @throws {Error} If validation fails
 */
export function validateBuffer(value: any, fieldName: string): void;

/**
 * Validate JSON string
 * @param value - Value to validate
 * @param fieldName - Name of the field for error messages
 * @returns Parsed JSON object
 * @throws {Error} If validation fails
 */
export function validateJSON(value: any, fieldName: string): any;

/**
 * Validate mnemonic phrase (12 or 24 words)
 * @param value - Value to validate
 * @param fieldName - Name of the field for error messages
 * @throws {Error} If validation fails
 */
export function validateMnemonic(value: any, fieldName: string): void;

/**
 * Validate word count (must be 12 or 24)
 * @param value - Value to validate
 * @param fieldName - Name of the field for error messages
 * @throws {Error} If validation fails
 */
export function validateWordCount(value: any, fieldName: string): void;
