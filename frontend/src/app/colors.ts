/** Distinct colour per position: every goal gets its own on the allocation chart. */
export const goalColor = (i: number): string => `hsl(${Math.round((i * 137.508 + 210) % 360)} 72% 46%)`;

/** Spending categories use a calmer family so goals stand out. */
export const categoryColor = (i: number): string => `hsl(${Math.round((i * 47 + 15) % 360)} 32% 52%)`;

export const FREE_COLOR = '#3e8635';
