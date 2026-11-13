/** Public links for the landing and about pages. */
export const REPO_URL = 'https://github.com/jervilangelo/opsentra';
export const AUTHOR_NAME = 'Jervil Angelo De Leon';
export const AUTHOR_URL = 'https://jervilangelo.online';

/** Inline style for a staggered entrance (index × step, plus a base delay). */
export const stagger = (index: number, stepMs = 90, baseMs = 0) => ({
  animationDelay: `${baseMs + index * stepMs}ms`,
});
