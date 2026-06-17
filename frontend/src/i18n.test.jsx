// @vitest-environment jsdom
// i18n 三语系统单测 — 纯函数 + LangProvider/useLang Context 行为 + 旧值迁移
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import {
  LANGS, localeFor, isZh, hasCJK, enFallback, tStatic,
  LangProvider, useLang,
} from './i18n.jsx';

// ─── 纯函数 ────────────────────────────────────────────────

describe('LANGS', () => {
  it('恰好三档：zh-CN / zh-TW / en', () => {
    expect(LANGS).toEqual(['zh-CN', 'zh-TW', 'en']);
  });
});

describe('localeFor', () => {
  it('en → en-US', () => expect(localeFor('en')).toBe('en-US'));
  it('zh-TW → zh-TW', () => expect(localeFor('zh-TW')).toBe('zh-TW'));
  it('zh-CN → zh-CN', () => expect(localeFor('zh-CN')).toBe('zh-CN'));
  it('未知值兜底 zh-CN', () => expect(localeFor('xx')).toBe('zh-CN'));
});

describe('isZh', () => {
  it('zh-CN / zh-TW 都算中文', () => {
    expect(isZh('zh-CN')).toBe(true);
    expect(isZh('zh-TW')).toBe(true);
  });
  it('en 不算中文', () => expect(isZh('en')).toBe(false));
});

describe('hasCJK', () => {
  it('纯中文 → true', () => expect(hasCJK('阿里巴巴')).toBe(true));
  it('中英混排 → true', () => expect(hasCJK('iShares 韩国 ETF')).toBe(true));
  it('纯英文 → false', () => expect(hasCJK('iShares MSCI South Korea ETF')).toBe(false));
  it('ticker / 数字 / 符号 → false', () => {
    expect(hasCJK('00700.HK')).toBe(false);
    expect(hasCJK('+1.23%')).toBe(false);
  });
  it('空 / 非字符串 → false', () => {
    expect(hasCJK('')).toBe(false);
    expect(hasCJK(null)).toBe(false);
    expect(hasCJK(undefined)).toBe(false);
    expect(hasCJK(123)).toBe(false);
  });
});

describe('enFallback', () => {
  it('name 已是英文 → 直接用', () => {
    expect(enFallback('Micron Technology', 'MU')).toBe('Micron Technology');
  });
  it('name 是中文且 EN 字典命中 → 英文名', () => {
    // '阿里巴巴' 在 EN 字典里 → 'Alibaba'
    expect(enFallback('阿里巴巴', 'BABA')).toBe('Alibaba');
  });
  it('name 是中文但字典未命中 → ticker 兜底', () => {
    expect(enFallback('某只没翻译的票', '600519.SS')).toBe('600519.SS');
  });
  it('name 为空 → ticker 兜底', () => {
    expect(enFallback('', '0700.HK')).toBe('0700.HK');
    expect(enFallback(null, '0700.HK')).toBe('0700.HK');
  });
  it('name 和 ticker 都空 → 空串', () => {
    expect(enFallback(null, null)).toBe('');
  });
});

describe('tStatic（无 hook 翻译）', () => {
  it('en：查 EN 字典', () => {
    expect(tStatic('量化评分', 'en')).toBe('Quant Scoring');
  });
  it('en：字典未命中 → 原样穿透', () => {
    expect(tStatic('一段不存在的文本', 'en')).toBe('一段不存在的文本');
  });
  it('zh-CN：简体穿透', () => {
    expect(tStatic('量化评分', 'zh-CN')).toBe('量化评分');
  });
  it('zh-TW：opencc 转繁体', () => {
    // 「评分」→「評分」，「软件」→「軟體」（台湾用语）
    expect(tStatic('量化评分', 'zh-TW')).toBe('量化評分');
    expect(tStatic('软件', 'zh-TW')).toBe('軟體');
  });
  it('zh-TW：post-process 修正「代码」→「代碼」而非「程式碼」', () => {
    expect(tStatic('股票代码', 'zh-TW')).toBe('股票代碼');
  });
  it('空文本 → 空串', () => {
    expect(tStatic('', 'en')).toBe('');
    expect(tStatic(null, 'zh-TW')).toBe('');
  });
});

// ─── LangProvider / useLang Context ────────────────────────

function Probe() {
  const { lang, setLang, t } = useLang();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="t-zh">{t('量化评分')}</span>
      <button onClick={() => setLang('zh-TW')}>tw</button>
      <button onClick={() => setLang('en')}>en</button>
    </div>
  );
}

const LANG_KEY = 'quantedge_lang';

describe('LangProvider / useLang', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); localStorage.clear(); });

  it('默认 zh-CN（无 localStorage）', () => {
    render(<LangProvider><Probe /></LangProvider>);
    expect(screen.getByTestId('lang').textContent).toBe('zh-CN');
    // 简体穿透
    expect(screen.getByTestId('t-zh').textContent).toBe('量化评分');
  });

  it('旧值 "zh" 自动迁移为 zh-CN', () => {
    localStorage.setItem(LANG_KEY, 'zh');
    render(<LangProvider><Probe /></LangProvider>);
    expect(screen.getByTestId('lang').textContent).toBe('zh-CN');
  });

  it('zh-HK 归一为 zh-TW', () => {
    localStorage.setItem(LANG_KEY, 'zh-HK');
    render(<LangProvider><Probe /></LangProvider>);
    expect(screen.getByTestId('lang').textContent).toBe('zh-TW');
  });

  it('无效值兜底 zh-CN', () => {
    localStorage.setItem(LANG_KEY, 'fr');
    render(<LangProvider><Probe /></LangProvider>);
    expect(screen.getByTestId('lang').textContent).toBe('zh-CN');
  });

  it('setLang 切换并持久化到 localStorage', () => {
    render(<LangProvider><Probe /></LangProvider>);
    act(() => screen.getByText('en').click());
    expect(screen.getByTestId('lang').textContent).toBe('en');
    expect(localStorage.getItem(LANG_KEY)).toBe('en');
    // en 模式查字典
    expect(screen.getByTestId('t-zh').textContent).toBe('Quant Scoring');
  });

  it('切到繁体后 t() 走 opencc', () => {
    render(<LangProvider><Probe /></LangProvider>);
    act(() => screen.getByText('tw').click());
    expect(screen.getByTestId('lang').textContent).toBe('zh-TW');
    expect(screen.getByTestId('t-zh').textContent).toBe('量化評分');
  });

  it('t() 参数插值', () => {
    function P() {
      const { t } = useLang();
      return <span data-testid="x">{t('{n}个标的', { n: 543 })}</span>;
    }
    render(<LangProvider><P /></LangProvider>);
    expect(screen.getByTestId('x').textContent).toBe('543个标的');
  });
});
