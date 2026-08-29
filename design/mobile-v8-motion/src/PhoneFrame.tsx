import { Interactive } from "remotion";

export const PhoneFrame: React.FC<{ children: React.ReactNode; activeTab: string }> = ({ children, activeTab }) => {
  return (
    <Interactive.Div
      name="Phone frame"
      style={{
        position: "absolute",
        left: 60,
        top: 144,
        width: 600,
        height: 1030,
        overflow: "hidden",
        borderRadius: 48,
        border: "1px solid #343846",
        backgroundColor: "#0E1017",
        boxShadow: "0 40px 100px rgba(0,0,0,.55)",
      }}
    >
      <div style={{ position: "absolute", top: 18, left: 255, width: 90, height: 24, borderRadius: 16, backgroundColor: "#050608", zIndex: 10 }} />
      <div style={{ position: "absolute", inset: "0 0 104px", overflow: "hidden" }}>{children}</div>
      <Interactive.Div
        name="Bottom navigation"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 104,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          borderTop: "1px solid #292D38",
          backgroundColor: "rgba(14,16,23,.96)",
        }}
      >
        {["评分", "监控", "日志", "宏观", "我的"].map((tab) => (
          <div key={tab} style={{ width: 90, textAlign: "center", color: activeTab === tab ? "#1ED395" : "#73798A", fontSize: 19, fontWeight: activeTab === tab ? 700 : 500 }}>
            <div style={{ width: 34, height: 4, margin: "0 auto 13px", borderRadius: 2, backgroundColor: activeTab === tab ? "#1ED395" : "transparent" }} />
            {tab}
          </div>
        ))}
      </Interactive.Div>
    </Interactive.Div>
  );
};

export const SceneHeader: React.FC<{ eyebrow: string; title: string; detail: string }> = ({ eyebrow, title, detail }) => (
  <>
    <Interactive.Div name="Scene eyebrow" style={{ position: "absolute", left: 60, top: 50, color: "#1ED395", fontFamily: "monospace", fontSize: 18, letterSpacing: 3, textTransform: "uppercase" }}>
      {eyebrow}
    </Interactive.Div>
    <Interactive.Div name="Scene title" style={{ position: "absolute", left: 60, top: 76, color: "#F5F7FA", fontSize: 42, lineHeight: 1.05, fontWeight: 760, letterSpacing: -1.5 }}>
      {title}
    </Interactive.Div>
    <Interactive.Div name="Scene detail" style={{ position: "absolute", right: 60, top: 88, width: 250, color: "#9BA1B0", fontSize: 18, textAlign: "right", lineHeight: 1.4 }}>
      {detail}
    </Interactive.Div>
  </>
);
