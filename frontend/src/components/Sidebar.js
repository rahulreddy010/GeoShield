// src/components/Sidebar.js
import React, { useState, useEffect, useRef } from "react";
import ControlPanel from "./ControlPanel";
import "./Sidebar.css";

function Sidebar({
  planes,
  speedETA,
  selectedPlane,
  setSelectedPlane,
  checkDestination,
  startSimulation,
  restartSimulation,
  simulationStarted,
  viewMode,
  setViewMode,
  simulationModeEnabled,
  setSimulationModeEnabled,
  satellites = [],
}) {
  const [inputs, setInputs] = useState({});
  const [satMetrics, setSatMetrics] = useState({});
  const [satStatuses, setSatStatuses] = useState({});
  const [selectedSat, setSelectedSat] = useState(null);
  const intervalsRef = useRef({});

  // 🔹 AI state
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  // ---------------- Utils ----------------
  const handleInputChange = (plane, field, value) => {
    setInputs((prev) => ({
      ...prev,
      [plane]: { ...prev[plane], [field]: value },
    }));
  };

  const handleCheck = (plane) => {
    if (inputs[plane]?.lat && inputs[plane]?.lon) {
      checkDestination(
        plane,
        parseFloat(inputs[plane].lat),
        parseFloat(inputs[plane].lon)
      );
    } else {
      alert("Enter both latitude & longitude");
    }
  };

  const clamp = (val, min = 0, max = 100) =>
    Math.max(min, Math.min(max, val));

  const ProgressBar = ({ value }) => {
    const safeVal = value != null ? clamp(Math.round(value)) : 0;
    let color = "gray";
    if (safeVal > 70) color = "limegreen";
    else if (safeVal > 30) color = "gold";
    else color = "red";

    return (
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{
            width: `${safeVal}%`,
            backgroundColor: color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "11px",
            color: "#04130a",
            fontWeight: 700,
          }}
        >
          {value != null ? `${safeVal}%` : "--"}
        </div>
      </div>
    );
  };

  const effectiveStatus = (sat, id) => {
    const override = satStatuses[id];
    if (override) return override;
    return (sat.status || "SAFE").toString().toUpperCase();
  };

  // ---------------- AI Fetch ----------------
  const fetchAIPrediction = async (features) => {
    try {
      setAiLoading(true);
      const res = await fetch("https://geoshield-1.onrender.com/ai_classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features }),
      });
      const data = await res.json();
      setAiResult(data);
    } catch (err) {
      console.error("AI fetch error:", err);
      setAiResult(null);
    } finally {
      setAiLoading(false);
    }
  };

  // 🔹 Auto-run AI whenever a satellite or plane is selected
  useEffect(() => {
    if (selectedSat) {
      const sat = satellites.find(
        (s, i) => (s.id || s.name || `sat-${i}`) === selectedSat
      );
      const metrics = satMetrics[selectedSat] || { health: 100, link: 100 };

      if (sat) {
        let spoofOffset = 0;
        let timeOffset = 0;
        if (metrics.falsified?.actual) {
          const dLat = metrics.falsified.lat - metrics.falsified.actual.lat;
          const dLon = metrics.falsified.lon - metrics.falsified.actual.lon;
          spoofOffset = Math.sqrt(dLat * dLat + dLon * dLon);
          timeOffset = metrics.falsified.timeOffset || 0;
        }

        // ✅ Standardized 7 features
        const features = [
          parseFloat(sat.position?.lat || 0),   // lat
          parseFloat(sat.position?.lon || 0),   // lon
          0,                                    // no speed for sats
          metrics.health,                       // health
          metrics.link,                         // link
          spoofOffset,                          // spoof offset distance
          timeOffset,                           // spoof time offset
        ];
        fetchAIPrediction(features);
      }
    } else if (selectedPlane) {
      const pos = planes[selectedPlane];
      const info = speedETA[selectedPlane] || {};
      if (pos) {
        // ✅ Standardized 7 features
        const features = [
          parseFloat(pos.lat || 0),             // lat
          parseFloat(pos.lon || 0),             // lon
          parseFloat(info.speed || 0),          // speed
          100,                                  // assume full health for planes
          100,                                  // assume strong link
          0,                                    // no spoof offset
          0,                                    // no spoof time offset
        ];
        fetchAIPrediction(features);
      }
    } else {
      setAiResult(null);
    }
  }, [selectedSat, selectedPlane, satMetrics, planes, satellites, speedETA]);

  // ---------------- Manual Actions ----------------
  const spoofSatellite = (id, sat) => {
    const offsetLat = (Math.random() - 0.5) * 1.0;
    const offsetLon = (Math.random() - 0.5) * 1.0;
    const timeOffset = Math.floor(5 + Math.random() * 15);

    const actualPos =
      sat?.lastTelemetry?.position ?? {
        lat: parseFloat(sat.position?.lat || sat.position?.[0] || 0),
        lon: parseFloat(sat.position?.lon || sat.position?.[1] || 0),
      };

    setSatStatuses((s) => ({ ...s, [id]: "SPOOFED" }));
    setSatMetrics((prev) => {
      const cur = prev[id] || { health: 100, link: 100 };
      return {
        ...prev,
        [id]: {
          ...cur,
          health: clamp(cur.health - 10),
          link: clamp(cur.link - 15),
          falsified: {
            lat: actualPos.lat + offsetLat,
            lon: actualPos.lon + offsetLon,
            timeOffset,
            actual: actualPos,
          },
        },
      };
    });
  };

  const jamSatellite = (id) => {
    setSatStatuses((s) => ({ ...s, [id]: "JAMMED" }));
    setSatMetrics((prev) => {
      const cur = prev[id] || { health: 100, link: 100 };
      return {
        ...prev,
        [id]: {
          ...cur,
          health: clamp(cur.health - 5),
          link: clamp(cur.link - 25),
        },
      };
    });
  };

  const repairSatellite = (id) => {
    setSatStatuses((s) => {
      const { [id]: _, ...rest } = s;
      return rest;
    });
    setSatMetrics((prev) => {
      const cur = prev[id] || { health: 100, link: 100 };
      const { falsified, ...rest } = cur;
      return {
        ...prev,
        [id]: {
          ...rest,
          health: clamp(cur.health + 15),
          link: clamp(cur.link + 20),
        },
      };
    });
  };

  // ---------------- Simulated metrics update ----------------
  useEffect(() => {
    const presentIds = satellites.map((s, i) => s.id || s.name || `sat-${i}`);
    Object.keys(intervalsRef.current).forEach((id) => {
      if (!presentIds.includes(id)) {
        clearInterval(intervalsRef.current[id]);
        delete intervalsRef.current[id];
      }
    });

    satellites.forEach((sat, idx) => {
      const id = sat.id || sat.name || `sat-${idx}`;
      if (intervalsRef.current[id]) return;

      intervalsRef.current[id] = setInterval(() => {
        setSatMetrics((prev) => {
          const cur = prev[id] || { health: 100, link: 100 };
          const stat = effectiveStatus(sat, id);
          const next = { ...prev, [id]: { ...cur } };

          if (stat === "SPOOFED") {
            next[id].health = clamp(cur.health - 1.5);
            next[id].link = clamp(cur.link - 2.5);
          } else if (stat === "JAMMED") {
            next[id].health = clamp(cur.health - 0.5);
            next[id].link = clamp(cur.link - 4);
          } else {
            next[id].health = clamp(cur.health + (100 - cur.health > 5 ? 2 : 1));
            next[id].link = clamp(cur.link + (100 - cur.link > 5 ? 2 : 1));
          }

          return next;
        });
      }, 600);
    });

    return () => {
      Object.values(intervalsRef.current).forEach(clearInterval);
      intervalsRef.current = {};
    };
  }, [satellites, satStatuses]);

  // ---------------- UI ----------------
  const isSpaceMode = viewMode === "space";
  const headerIcon = isSpaceMode ? "🛰" : "✈";
  const headerTitle = isSpaceMode ? "Active Satellites" : "Active Planes";

  // 🔹 helper to compare AI vs manual
  const renderAIPrediction = (manualStatus) => {
    if (!aiResult) return null;

    const aiStatus = aiResult.prediction?.toUpperCase();
    const confidence = Math.round(
      Math.max(...(aiResult.probabilities || [0])) * 100
    );

    const mismatch =
      aiStatus && manualStatus && aiStatus !== manualStatus.toUpperCase();

    return (
      <div
        className="ai-result"
        style={{
          marginTop: 6,
          color: mismatch ? "orange" : "#0ff",
          fontWeight: mismatch ? 700 : 500,
        }}
      >
        <strong>AI:</strong>{" "}
        {aiLoading
          ? "Loading..."
          : aiStatus
          ? `${aiStatus} (${confidence}%)`
          : "(no data)"}
        {mismatch && (
          <span style={{ marginLeft: 8, color: "red" }}>⚠ </span>
        )}
      </div>
    );
  };

  return (
    <div className="sidebar-left">
      <div className="brand">
        <img
          src={process.env.PUBLIC_URL + "/logo-glow.png"}
          alt="GeoShield Logo"
          className="logo-background"
        />
      </div>

      <div className="card planes-card">
        <h4>
          {headerIcon} {headerTitle}
        </h4>
        <div className="planes-list">
          {/* Satellites */}
          {isSpaceMode ? (
            satellites.length === 0 ? (
              <div className="empty">No satellites active. Enable Space Mode.</div>
            ) : (
              satellites.map((sat, idx) => {
                if (!sat) return null;
                const id = sat.id || sat.name || `sat-${idx}`;
                const status = effectiveStatus(sat, id);
                const metrics = satMetrics[id] || { health: 100, link: 100 };

                return (
                  <div
                    key={id}
                    className="plane-item"
                    onClick={() =>
                      setSelectedSat((prev) => (prev === id ? null : id))
                    }
                    style={{ cursor: "pointer" }}
                  >
                    <div className="pi-top">
                      <div>
                        <strong>{sat.name || "Unknown Satellite"}</strong>
                        {sat.id && sat.id !== sat.name && (
                          <small> ({sat.id})</small>
                        )}
                      </div>
                      <div
                        className={`status ${
                          status === "SAFE"
                            ? "safe"
                            : status === "JAMMED"
                            ? "warning"
                            : status === "SPOOFED"
                            ? "spoofed"
                            : "critical"
                        }`}
                      >
                        {status}
                      </div>
                    </div>

                    {/* 🔹 Show AI prediction if this sat is selected */}
                    {selectedSat === id && renderAIPrediction(status)}

                    <div className="pi-bottom">
                      <div style={{ flex: 1, marginRight: "6px" }}>
                        <span>Health:</span>
                        <ProgressBar value={metrics.health} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <span>Link:</span>
                        <ProgressBar value={metrics.link} />
                      </div>
                    </div>

                    {/* Spoofed info */}
                    {status === "SPOOFED" && metrics.falsified && (
                      <div
                        className="pi-bottom"
                        style={{ display: "flex", gap: "12px" }}
                      >
                        <div style={{ color: "red" }}>
                          <strong>Reported (falsified):</strong>
                          <div>Lat: {metrics.falsified.lat.toFixed(4)}</div>
                          <div>Lon: {metrics.falsified.lon.toFixed(4)}</div>
                          <div>Time offset: {metrics.falsified.timeOffset}s</div>
                        </div>
                        <div style={{ color: "lime" }}>
                          <strong>Actual:</strong>
                          <div>
                            Lat:{" "}
                            {metrics.falsified.actual?.lat?.toFixed(4) ?? "--"}
                          </div>
                          <div>
                            Lon:{" "}
                            {metrics.falsified.actual?.lon?.toFixed(4) ?? "--"}
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedSat === id && (
                      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                        <button
                          className="spoof-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            spoofSatellite(id, sat);
                          }}
                        >
                          Spoof
                        </button>
                        <button
                          className="spoof-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            jamSatellite(id);
                          }}
                        >
                          Jam
                        </button>
                        <button
                          className="spoof-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            repairSatellite(id);
                          }}
                        >
                          Repair
                        </button>
                        <button
                          style={{
                            padding: "6px 10px",
                            borderRadius: 6,
                            background: "#555",
                            color: "white",
                            border: "none",
                            cursor: "pointer",
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSat(null);
                          }}
                        >
                          Close
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : Object.keys(planes).length === 0 ? (
            <div className="empty">
              {simulationModeEnabled
                ? "No simulation planes yet. Start simulation."
                : "No real-time planes transferred from Globe yet."}
            </div>
          ) : (
            Object.keys(planes).map((plane) => {
              const pos = planes[plane];
              const info = speedETA[plane] || {};
              const isSelected = plane === selectedPlane;

              return (
                <div
                  key={plane}
                  className={`plane-item ${isSelected ? "selected" : ""}`}
                  onClick={() => setSelectedPlane(plane)}
                >
                  <div className="pi-top">
                    <div>
                      <strong>{plane}</strong>
                    </div>
                    <div
                      className={`status ${
                        pos.status === "SAFE" ? "safe" : "spoofed"
                      }`}
                    >
                      {pos.status}
                    </div>
                  </div>

                  {/* 🔹 AI prediction for selected plane */}
                  {isSelected && renderAIPrediction(pos.status)}

                  {pos.reason && (
                    <div className="spoof-reason">Reason: {pos.reason}</div>
                  )}

                  <div className="pi-bottom">
                    <div>Lat: {pos.lat?.toFixed(4) || "--"}</div>
                    <div>Lon: {pos.lon?.toFixed(4) || "--"}</div>
                    <div>Speed: {info.speed || "--"} km/h</div>
                    <div>ETA: {info.eta || "--"}</div>
                  </div>

                  <div className="dest-check">
                    <input
                      type="number"
                      step="0.0001"
                      placeholder="Lat"
                      value={inputs[plane]?.lat || ""}
                      onChange={(e) =>
                        handleInputChange(plane, "lat", e.target.value)
                      }
                    />
                    <input
                      type="number"
                      step="0.0001"
                      placeholder="Lon"
                      value={inputs[plane]?.lon || ""}
                      onChange={(e) =>
                        handleInputChange(plane, "lon", e.target.value)
                      }
                    />
                    <button
                      className="spoof-button"
                      onClick={() => handleCheck(plane)}
                    >
                      Spoof
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <ControlPanel
        startSimulation={startSimulation}
        restartSimulation={restartSimulation}
        simulationStarted={simulationStarted}
        viewMode={viewMode}
        setViewMode={setViewMode}
        simulationModeEnabled={simulationModeEnabled}
        setSimulationModeEnabled={setSimulationModeEnabled}
      />
    </div>
  );
}

export default Sidebar;
