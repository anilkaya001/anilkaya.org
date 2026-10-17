let who = null;

export const touch = (name) => {
  if (who === null) who = String(name);
};

export const tainted = () => who;

export const clearTaint = () => {
  who = null;
};
