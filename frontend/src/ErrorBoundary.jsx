import React from 'react';

/**
 * 全局 Error Boundary — 捕获 React 渲染错误，避免整页白屏。
 * 显示友好降级页，提供"重置状态 + 重载" / "清空本地数据 + 重载"两个出口。
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // 尽力记录到 console，便于排查
    console.error('[QuantEdge:ErrorBoundary]', error, info);
    this.setState({ info });
  }

  reload = () => { window.location.reload(); };

  hardReset = () => {
    try {
      // 只清理 QuantEdge 自己的键，避免误删其他站点数据
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('quantedge_')) keys.push(k);
      }
      keys.forEach(k => localStorage.removeItem(k));
    } catch {}
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message || String(this.state.error);
    const stack = this.state.error?.stack || '';
    return (
      <div style={{
        minHeight: '100vh', background: 'radial-gradient(ellipse at 20% 0%, #1A1A2E 0%, #0B0B15 50%, #0B0B15 100%)',
        color: '#e2e8f0', fontFamily: "'DM Sans', system-ui, sans-serif",
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}>
        <div style={{
          maxWidth: 560, width: '100%',
          background: 'rgba(22,22,37,0.7)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          padding: '28px 24px',
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(255,107,107,0.2), rgba(245,158,11,0.2))',
            border: '1px solid rgba(255,107,107,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16, fontSize: 22,
          }}>⚠️</div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#fff' }}>
            页面遇到了一个渲染错误
          </h1>
          <p style={{ margin: '8px 0 16px', fontSize: 13, color: '#a0aec0', lineHeight: 1.6 }}>
            应用运行中出现了未捕获的异常。你可以尝试重新加载；如果问题持续，建议清空本地缓存数据再试。
          </p>
          <details style={{ marginBottom: 20 }}>
            <summary style={{ fontSize: 11, color: '#778', cursor: 'pointer', userSelect: 'none' }}>
              技术细节（点击展开）
            </summary>
            <div style={{
              marginTop: 10, padding: 10, borderRadius: 8,
              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)',
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
              color: '#ff9a9a', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 200, overflow: 'auto',
            }}>
              {msg}
              {stack && <div style={{ color: '#667', marginTop: 8, fontSize: 10 }}>{stack}</div>}
            </div>
          </details>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={this.reload} style={{
              flex: 1, padding: '10px 16px', borderRadius: 8,
              background: 'linear-gradient(to right, #6366f1, #8b5cf6)',
              color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
            }}>重新加载</button>
            <button onClick={this.hardReset} style={{
              padding: '10px 16px', borderRadius: 8,
              background: 'rgba(255,107,107,0.1)', color: '#FF6B6B',
              fontSize: 13, fontWeight: 500, border: '1px solid rgba(255,107,107,0.3)', cursor: 'pointer',
            }}>清空数据后重载</button>
          </div>
        </div>
      </div>
    );
  }
}
