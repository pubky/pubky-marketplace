import { expect } from 'vitest';

type Rgba = [number, number, number, number];

function rgba(color: string): Rgba {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}

function over(ink: Rgba, fill: Rgba): Rgba {
  const alpha = ink[3] + fill[3] * (1 - ink[3]);
  if (alpha === 0) return [0, 0, 0, 0];
  return [
    (ink[0] * ink[3] + fill[0] * fill[3] * (1 - ink[3])) / alpha,
    (ink[1] * ink[3] + fill[1] * fill[3] * (1 - ink[3])) / alpha,
    (ink[2] * ink[3] + fill[2] * fill[3] * (1 - ink[3])) / alpha,
    alpha,
  ];
}

function paint(element: Element, ink: Rgba = [0, 0, 0, 0]): Rgba {
  let pixel = ink;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    pixel = over(pixel, rgba(style.backgroundColor));
    pixel[3] *= Number(style.opacity);
  }
  return over(pixel, [255, 255, 255, 1]);
}

function luminance(color: Rgba): number {
  const channels = color.slice(0, 3).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function expectContrast(ink: Rgba, fill: Rgba, minimum: number) {
  const values = [luminance(ink), luminance(fill)].sort((a, b) => b - a);
  expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(minimum);
}

/** Browser-only check for text on solid/translucent CSS backgrounds, including inherited fills. */
export function expectTextContrast(element: Element, minimum = 4.5) {
  expectContrast(paint(element, rgba(getComputedStyle(element).color)), paint(element), minimum);
}

/** Icons use their current color; solid control markers use their background color. */
export function expectGraphicContrast(element: Element, surface: Element, minimum = 3) {
  const style = getComputedStyle(element);
  const ink = rgba(style.backgroundColor);
  expectContrast(paint(element, ink[3] === 0 ? rgba(style.color) : undefined), paint(surface), minimum);
}
