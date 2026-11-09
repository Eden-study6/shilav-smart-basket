import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Compose Tailwind classes, letting later conditional classes win over earlier ones. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

/** Prices are stored as plain numbers; format at the display layer only. */
export const formatPrice = (value: number): string => `₪${value.toFixed(2)}`;
