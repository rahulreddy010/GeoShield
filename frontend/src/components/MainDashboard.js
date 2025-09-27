// src/components/MainDashboard.js
import React, { useState, useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Tooltip,
  Polyline,
  LayersControl,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../App.css";

import GlobeInstanced from "./GlobeInstanced";
import SpaceView from "./SpaceView";
import Sidebar from "./Sidebar";
import AlertsPanel from "./AlertsPanel";
import EventLogs from "./EventLogs";
import ZoomControls from "./ZoomControls";
import { interpolatePath, hashHMAC } from "../utils/helpers";
import SpaceModeSim from "./SpaceModeSim";

const { BaseLayer } = LayersControl;
const indiaCenter = [22.0, 79.0];

// Plane icon
const planeIcon = new L.Icon({
  iconUrl: process.env.PUBLIC_URL + "/plane.png",
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

// Alert icon
const alertIcon = new L.Icon({
  iconUrl: process.env.PUBLIC_URL + "/alert.png",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function MainDashboard({ onLogout }) {
  const [planes, setPlanes] = useState({});
  const [trajectories, setTrajectories] = useState({});
  const [simulationStarted, setSimulationStarted] = useState(false);
  const [speedETA, setSpeedETA] = useState({});
  const [selectedPlane, setSelectedPlane] = useState(null);
  const [spoofedPaths, setSpoofedPaths] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [eventLogs, setEventLogs] = useState([]);

  // Modes
  const [viewMode, setViewMode] = useState("map");
  const [simulationModeEnabled, setSimulationModeEnabled] = useState(true);
  const [realTimePlanes, setRealTimePlanes] = useState({});
  const [spaceModeEnabled, setSpaceModeEnabled] = useState(false);

  // 🚀 Satellites (source of truth here)
  const [spaceSatellites, setSpaceSatellites] = useState([]);

  const audioRef = useRef(
    new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg")
  );
  const mapRef = useRef(null);

  // --- Restart ---
  const restartSimulation = () => {
    window.location.reload();
  };

  // --- Start simulation (CSV) ---
  const startSimulation = async () => {
    try {
      const csvFiles = ["plane1.csv", "plane2.csv", "plane3.csv"];
      const signature = await hashHMAC(csvFiles.join(","), "supersecretkey");

      const res = await fetch("https://geoshield-1.onrender.com/live_planes_multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv_files: csvFiles, signature }),
      });

      const data = await res.json();
      const trajs = {};
      const startPositions = {};
      Object.keys(data).forEach((plane) => {
        const allPoints = data[plane].trajectory;
        const interpolated = interpolatePath(allPoints, 60);
        trajs[plane] = interpolated;
        startPositions[plane] = {
          lat: interpolated[0].lat,
          lon: interpolated[0].lon,
          status: "SAFE",
        };
      });

      setPlanes(startPositions);
      setTrajectories(trajs);
      setSimulationStarted(true);
      setSimulationModeEnabled(true);
      addEventLog("Simulation started with trajectories.");
    } catch (err) {
      console.error("Simulation error:", err);
    }
  };

  // --- Step simulation ---
  useEffect(() => {
    if (!simulationStarted) return;
    const intervals = {};

    Object.keys(trajectories).forEach((plane) => {
      if (spoofedPaths[plane]) return;

      let index = 0;
      intervals[plane] = setInterval(() => {
        setPlanes((prev) => {
          if (index < trajectories[plane].length) {
            const prevPos =
              index > 0
                ? trajectories[plane][index - 1]
                : trajectories[plane][0];
            const currPos = trajectories[plane][index];

            const dist = L.latLng(prevPos.lat, prevPos.lon).distanceTo(
              L.latLng(currPos.lat, currPos.lon)
            );
            const speed = (dist * 3.6).toFixed(1);
            const eta = Math.max(0, trajectories[plane].length - index) + "s";

            setSpeedETA((old) => ({ ...old, [plane]: { speed, eta } }));

            const speedLimit = 450000;
            if (parseFloat(speed) > speedLimit) {
              setPlanes((prev) => ({
                ...prev,
                [plane]: {
                  ...prev[plane],
                  status: "SPOOFED",
                  reason: "Impossible speed",
                },
              }));
              pushAlert({
                flight: plane,
                desc: "Impossible speed detected",
                severity: "High",
              });
              addEventLog(
                `${plane} flagged for impossible speed: ${speed} km/h`
              );
            }

            return {
              ...prev,
              [plane]: {
                ...prev[plane],
                lat: currPos.lat,
                lon: currPos.lon,
                status: prev[plane].status || "SAFE",
              },
            };
          }
          return prev;
        });
        index++;
      }, 1000);
    });

    return () => Object.values(intervals).forEach(clearInterval);
  }, [simulationStarted, trajectories, spoofedPaths]);

  // --- Drag spoof detection ---
  const handleDragEnd = (planeId, e) => {
    const pos = e.target.getLatLng();

    if (planes[planeId]) {
      const originalPos = planes[planeId];
      setSpoofedPaths((prev) => ({
        ...prev,
        [planeId]: [
          [originalPos.lat, originalPos.lon],
          [pos.lat, pos.lng],
        ],
      }));
      setPlanes((prev) => ({
        ...prev,
        [planeId]: {
          ...prev[planeId],
          lat: pos.lat,
          lon: pos.lng,
          status: "SPOOFED",
          reason: "Unrealistic jump",
        },
      }));
      pushAlert({
        flight: planeId,
        desc: "Manual Drag Spoof → Unrealistic jump (simulation)",
        severity: "Medium",
      });
      addEventLog(`${planeId} spoofed via drag (simulation).`);
      audioRef.current.play();
      return;
    }

    if (realTimePlanes[planeId]) {
      const originalPos = realTimePlanes[planeId];
      const dist = L.latLng(originalPos.lat, originalPos.lon).distanceTo(
        L.latLng(pos.lat, pos.lng)
      );
      setSpoofedPaths((prev) => ({
        ...prev,
        [planeId]: [
          [originalPos.lat, originalPos.lon],
          [pos.lat, pos.lng],
        ],
      }));
      setRealTimePlanes((prev) => ({
        ...prev,
        [planeId]: {
          ...prev[planeId],
          lat: pos.lat,
          lon: pos.lng,
          status: "SPOOFED",
          reason: "Manual drag (real-time)",
        },
      }));

      const largeMoveThresholdMeters = 50000;
      if (dist > largeMoveThresholdMeters) {
        pushAlert({
          flight: planeId,
          desc: "Real-time plane moved far suddenly → SPOOFED",
          severity: "High",
        });
        addEventLog(`${planeId} moved ${Math.round(dist)}m → flagged SPOOFED.`);
      } else {
        pushAlert({
          flight: planeId,
          desc: "Real-time manual drag (small)",
          severity: "Medium",
        });
        addEventLog(`${planeId} manually moved (real-time).`);
      }
      audioRef.current.play();
      return;
    }

    console.warn("Dragged plane not found in either dataset:", planeId);
  };

  // --- Destination spoof detection ---
  const checkDestination = (planeId, lat, lon) => {
    if (trajectories[planeId]) {
      const originalDest =
        trajectories[planeId][trajectories[planeId].length - 1];
      const d = L.latLng(lat, lon).distanceTo(
        L.latLng(originalDest.lat, originalDest.lon)
      );

      const zoom = mapRef.current ? mapRef.current.getZoom() : 5;
      const threshold = 200000 / zoom;

      if (d > threshold) {
        setPlanes((prev) => ({
          ...prev,
          [planeId]: {
            ...prev[planeId],
            lat,
            lon,
            status: "SPOOFED",
            reason: "GPS mismatch",
          },
        }));
        setSpoofedPaths((prev) => ({
          ...prev,
          [planeId]: [
            [originalDest.lat, originalDest.lon],
            [lat, lon],
          ],
        }));
        pushAlert({
          flight: planeId,
          desc: "GPS mismatch (simulation)",
          severity: "Medium",
        });
        addEventLog(`${planeId} wrong destination → SPOOFED (simulation).`);
        audioRef.current.play();
      } else {
        addEventLog(`${planeId} destination OK (simulation).`);
      }
      return;
    }

    if (realTimePlanes[planeId]) {
      const originalPos = realTimePlanes[planeId];
      const d = L.latLng(lat, lon).distanceTo(
        L.latLng(originalPos.lat, originalPos.lon)
      );

      const zoom = mapRef.current ? mapRef.current.getZoom() : 5;
      const threshold = 50000 / zoom;

      if (d > threshold) {
        setRealTimePlanes((prev) => ({
          ...prev,
          [planeId]: {
            ...prev[planeId],
            lat,
            lon,
            status: "SPOOFED",
            reason: "GPS mismatch (real-time)",
          },
        }));
        setSpoofedPaths((prev) => ({
          ...prev,
          [planeId]: [
            [originalPos.lat, originalPos.lon],
            [lat, lon],
          ],
        }));
        pushAlert({
          flight: planeId,
          desc: "GPS mismatch (real-time)",
          severity: "Medium",
        });
        addEventLog(`${planeId} wrong destination → SPOOFED (real-time).`);
        audioRef.current.play();
      } else {
        addEventLog(`${planeId} destination OK (real-time).`);
      }
      return;
    }

    addEventLog(`${planeId} destination check attempted but plane not found.`);
  };

  // --- Alerts & Logs ---
  const pushAlert = (a) => {
    const t = new Date();
    setAlerts((prev) =>
      [{ ...a, time: t.toLocaleTimeString() }, ...prev].slice(0, 10)
    );
  };
  const addEventLog = (msg) => {
    const t = new Date();
    setEventLogs((prev) =>
      [{ time: t.toLocaleTimeString(), msg }, ...prev].slice(0, 30)
    );
  };

  // --- Auto alert for SPOOFED ---
  useEffect(() => {
    Object.keys(planes).forEach((p) => {
      if (planes[p].status === "SPOOFED") {
        if (!alerts.some((a) => a.flight === p && a.desc.includes("Spoof"))) {
          pushAlert({ flight: p, desc: "Spoof detected", severity: "High" });
        }
      }
    });

    Object.keys(realTimePlanes).forEach((p) => {
      if (realTimePlanes[p].status === "SPOOFED") {
        if (!alerts.some((a) => a.flight === p && a.desc.includes("Spoof"))) {
          pushAlert({
            flight: p,
            desc: "Real-time spoof detected",
            severity: "High",
          });
        }
      }
    });
  }, [planes, realTimePlanes, alerts]);

  // --- Clear alerts/logs when mode changes ---
  useEffect(() => {
    setAlerts([]);
    setEventLogs([]);
    setSpoofedPaths({}); // reset spoofed overlays
  }, [viewMode]);

  // --- Transfer from globe ---
  const transferFromGlobe = (flight) => {
    const id = flight.icao24 || flight.callsign || `plane-${Date.now()}`;
    setRealTimePlanes((prev) => ({
      ...prev,
      [id]: {
        lat: flight.lat,
        lon: flight.lon,
        status: "SAFE",
        lastUpdate: flight.lastUpdate || Date.now() / 1000,
        raw: flight,
      },
    }));
    addEventLog(`${id} transferred from Globe → Real-Time Mode`);
    pushAlert({ flight: id, desc: "Transferred from Globe", severity: "Info" });
  };

  // --- Active dataset ---
  const activePlanes = simulationModeEnabled ? { ...planes } : { ...realTimePlanes };

  return (
    <div className="app-grid">
      <Sidebar
        planes={activePlanes}
        speedETA={speedETA}
        selectedPlane={selectedPlane}
        setSelectedPlane={setSelectedPlane}
        checkDestination={checkDestination}
        startSimulation={startSimulation}
        restartSimulation={restartSimulation}
        simulationStarted={simulationStarted}
        viewMode={viewMode}
        setViewMode={setViewMode}
        simulationModeEnabled={simulationModeEnabled}
        setSimulationModeEnabled={setSimulationModeEnabled}
        satellites={spaceSatellites}
      />

      <main className="main-area">
        <div className="map-card card">
          {viewMode === "map" ? (
            <MapContainer
              center={indiaCenter}
              zoom={3}
              style={{ height: "100%", width: "100%" }}
              whenCreated={(map) => (mapRef.current = map)}
              maxBounds={[
                [-85, -180],
                [85, 180],
              ]}
              maxBoundsViscosity={1.0}
              minZoom={2}
              maxZoom={8}
            >
              <ZoomControls />
              <LayersControl position="topright">
                <BaseLayer name="OpenStreetMap">
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                </BaseLayer>

                <BaseLayer checked name="ESRI Satellite (with labels)">
                  <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    noWrap={true}
                    bounds={[
                      [-85, -180],
                      [85, 180],
                    ]}
                  />
                  <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                    noWrap={true}
                    bounds={[
                      [-85, -180],
                      [85, 180],
                    ]}
                  />
                </BaseLayer>
              </LayersControl>

              {Object.keys(activePlanes).map((planeId) => {
                const pos = activePlanes[planeId];
                return (
                  <React.Fragment key={planeId}>
                    {trajectories[planeId] && (
                      <Polyline
                        positions={(trajectories[planeId] || []).map((p) => [
                          p.lat,
                          p.lon,
                        ])}
                        pathOptions={{
                          color: "green",
                          dashArray: "6,8",
                          weight: 3,
                        }}
                      />
                    )}

                    {spoofedPaths[planeId] && (
                      <Polyline
                        positions={spoofedPaths[planeId]}
                        pathOptions={{
                          color: "red",
                          dashArray: "6,8",
                          weight: 3,
                        }}
                      />
                    )}

                    {/* Skip rendering map markers for satellites */}
                    {!pos.isSatellite && (
                      <Marker
                        position={[pos.lat, pos.lon]}
                        icon={planeIcon}
                        draggable={true}
                        eventHandlers={{
                          dragend: (e) => handleDragEnd(planeId, e),
                        }}
                      >
                        <Tooltip direction="top" offset={[0, -20]} permanent>
                          <div
                            className={`tooltip-text ${
                              pos.status === "SAFE" ? "safe" : "spoofed"
                            }`}
                          >
                            {planeId}: {pos.status}
                            {pos.reason && (
                              <span className="spoof-reason">
                                ({pos.reason})
                              </span>
                            )}
                          </div>
                        </Tooltip>
                      </Marker>
                    )}

                    {pos.status === "SPOOFED" && !pos.isSatellite && (
                      <Marker
                        position={[pos.lat + 0.05, pos.lon]}
                        icon={alertIcon}
                        interactive={false}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </MapContainer>
          ) : viewMode === "globe" ? (
            <GlobeInstanced
              apiUrl="https://opensky-network.org/api/states/all?lamin=6&lomin=68&lamax=36&lomax=97"
              onTransferToMap={transferFromGlobe}
            />
          ) : (
            // ✅ Pass setSpaceSatellites so SpaceView updates parent
            <SpaceView
              satellites={spaceSatellites}
              setSatellites={setSpaceSatellites}
            />
          )}
        </div>
      </main>

      <aside className="right-col">
        <AlertsPanel alerts={alerts} />
        <EventLogs logs={eventLogs} />

        {/* ✅ SpaceModeSim simulation */}
        {spaceModeEnabled && (
          <SpaceModeSim
            spaceModeEnabled={spaceModeEnabled}
            onSatellitesUpdate={setSpaceSatellites}
            onNewAlert={(a) => setAlerts((prev) => [a, ...prev])}
            onNewEvent={(e) => setEventLogs((prev) => [e, ...prev])}
          />
        )}

        <div style={{ marginTop: "20px", textAlign: "center" }}>
          <button onClick={onLogout} className="logout-button">
            Logout
          </button>
        </div>
      </aside>
    </div>
  );
}

export default MainDashboard;
