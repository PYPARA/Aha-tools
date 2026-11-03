import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, openPath } from "@ahatools/sdk";
import Row from "./Row";
import appIcon from "../../src/assets/app-icon.png";

export default function About() {
  const [version, setVersion] = useState("");
  const [dir, setDir] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("开发版"));
    invoke<string>("config_dir").then(setDir);
  }, []);

  return (
    <>
      <div className="detail-head" style={{ marginBottom: 12 }}>
        {/* The PNG keeps the macOS icon margins; the negative margin lines its body up with 44px tiles. */}
        <img src={appIcon} width={54} height={54} alt="" style={{ margin: -5, flexShrink: 0 }} />
        <span>
          <strong>AhaTools</strong>
          <span className="note">轻量的菜单栏工具箱 · 版本 {version}</span>
        </span>
      </div>
      <Row title="数据目录" desc={<span className="mono">{dir}</span>}>
        <button type="button" className="btn" onClick={() => openPath(dir)}>
          在访达中显示
        </button>
      </Row>
    </>
  );
}
