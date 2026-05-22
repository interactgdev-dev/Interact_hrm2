export const formatDuration = (totalSeconds?: number) => {
  if (totalSeconds === undefined || totalSeconds === null || isNaN(totalSeconds)) return "00h 00m 00s";

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const pad = (num: number) => num.toString().padStart(2, "0");

  return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
};
