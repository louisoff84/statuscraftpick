export function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Élément #${id} introuvable`);
  return found as T;
}

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function installCursor(ringElement?: HTMLElement): void {
  if (matchMedia("(pointer: coarse)").matches) return;
  const dot = element<HTMLElement>("cursor-dot");
  let mouseX = 0;
  let mouseY = 0;
  let ringX = 0;
  let ringY = 0;
  window.addEventListener("mousemove", (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    dot.style.left = `${mouseX}px`;
    dot.style.top = `${mouseY}px`;
  });
  if (!ringElement) return;
  const animate = () => {
    ringX += (mouseX - ringX) * 0.2;
    ringY += (mouseY - ringY) * 0.2;
    ringElement.style.left = `${ringX}px`;
    ringElement.style.top = `${ringY}px`;
    requestAnimationFrame(animate);
  };
  animate();
}
