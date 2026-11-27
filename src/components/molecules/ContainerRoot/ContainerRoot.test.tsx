// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RootContainer } from './ContainerRoot';

vi.mock('next/font/google', () => ({ Inter_Tight: () => ({ variable: 'font-variable' }) }));
vi.mock('next/script', () => ({
  default: ({ strategy: _strategy, ...props }: React.ComponentProps<'script'> & { strategy?: string }) => (
    <script {...props} />
  ),
}));
vi.mock('@/libs/runtime-config/runtime-config', () => ({
  getEmbeddedFlag: () => false,
  getPlausibleDomain: () => 'shop.example',
  getPlausibleScriptUrl: () => 'https://analytics.example/script.js',
  serializeRuntimeConfig: () => '{}',
}));

describe('RootContainer analytics', () => {
  it('omits Plausible when the layout disables it for setup or a minimal store document', () => {
    const markup = renderToStaticMarkup(
      <RootContainer showPlausible={false}>
        <div>Store setup</div>
      </RootContainer>,
    );

    expect(markup).not.toContain('pubky-plausible-page-url');
    expect(markup).not.toContain('https://analytics.example/script.js');
  });

  it('renders Plausible when the layout allows it', () => {
    const markup = renderToStaticMarkup(
      <RootContainer>
        <div>Store catalog</div>
      </RootContainer>,
    );

    expect(markup).toContain('pubky-plausible-page-url');
    expect(markup).toContain('https://analytics.example/script.js');
  });
});
