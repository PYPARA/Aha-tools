import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, openPath } from "@ahatools/sdk";
import Row from "./Row";

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
        <span className="tile xl" aria-hidden="true" style={{ fontFamily: "var(--serif)", fontSize: 20 }}>
          A
        </span>
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
