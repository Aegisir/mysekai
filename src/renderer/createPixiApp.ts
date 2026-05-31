import { Application } from 'pixi.js';

import { pickRenderQuality, type RenderQuality } from '@/renderer/renderQuality';

export type PixiApp = Application;

export const createPixiApp = async (quality: RenderQuality = pickRenderQuality()): Promise<PixiApp> => {
  const app = new Application();

  await app.init({
    width: 1,
    height: 1,
    autoDensity: true,
    autoStart: true,
    backgroundAlpha: 0,
    preserveDrawingBuffer: true,
    antialias: quality.antialias,
    preference: 'webgl',
    powerPreference: 'high-performance',
    resolution: quality.resolution,
    sharedTicker: false,
  });

  app.ticker.maxFPS = quality.maxFps;

  return app;
};
