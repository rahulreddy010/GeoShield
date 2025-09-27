// src/components/SpaceView.js
import React, { useRef, useMemo, useState, useEffect, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Stars, OrbitControls, useGLTF, Html } from "@react-three/drei";
import * as THREE from "three";
import Globe from "./Globe";

// ================== Satellite Model ==================
function SatelliteModel({ radius, speed, modelUrl, scale = 0.02, name, status }) {
  const ref = useRef();
  const { scene } = useGLTF(modelUrl);

  const angle = useRef(Math.random() * Math.PI * 2);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * speed + angle.current;
    const x = radius * Math.cos(t);
    const z = radius * Math.sin(t);
    if (ref.current) {
      ref.current.position.set(x, 0, z);
      ref.current.rotation.y += 0.002; // slow spin
    }
  });

  const labelColor =
    status === "OK"
      ? "lime"
      : status === "JAMMED"
      ? "yellow"
      : status === "SPOOFED"
      ? "red"
      : "white";

  return (
    <group ref={ref}>
      <primitive object={scene.clone()} scale={scale} />
      <Html
        transform
        distanceFactor={12}
        position={[0, 0.8, 0]}
        style={{
          background: "rgba(0,0,0,0.6)",
          padding: "2px 6px",
          borderRadius: "4px",
          fontSize: "12px",
          color: labelColor,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {name}
      </Html>
    </group>
  );
}

// ================== Orbit ==================
function Orbit({ radius, color }) {
  const points = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= 360; i++) {
      const rad = (i * Math.PI) / 180;
      pts.push(new THREE.Vector3(radius * Math.cos(rad), 0, radius * Math.sin(rad)));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [radius]);

  return (
    <line>
      <primitive object={points} attach="geometry" />
      <lineBasicMaterial color={color} linewidth={2} />
    </line>
  );
}

// ================== Asteroids ==================
function Asteroids({ count = 20, radius = 15 }) {
  const groupRef = useRef();
  const asteroids = useMemo(
    () =>
      new Array(count).fill().map(() => ({
        x: (Math.random() - 0.5) * radius,
        y: (Math.random() - 0.5) * radius,
        z: (Math.random() - 0.5) * radius,
        rot: new THREE.Vector3(
          Math.random() * 0.01,
          Math.random() * 0.01,
          Math.random() * 0.01
        ),
      })),
    [count, radius]
  );

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.children.forEach((mesh, i) => {
      mesh.rotation.x += asteroids[i].rot.x;
      mesh.rotation.y += asteroids[i].rot.y;
      mesh.rotation.z += asteroids[i].rot.z;
    });
  });

  return (
    <group ref={groupRef}>
      {asteroids.map((a, i) => (
        <mesh key={i} position={[a.x, a.y, a.z]}>
          <icosahedronGeometry args={[0.1, 0]} />
          <meshStandardMaterial color="gray" roughness={1} metalness={0.1} />
        </mesh>
      ))}
    </group>
  );
}

// ================== Helper ==================
function computeRadiusFromPosition(positionArray, fallback = 42000) {
  try {
    if (!positionArray || !Array.isArray(positionArray) || positionArray.length < 3)
      return fallback;
    const [x, y, z] = positionArray.map((v) => Number(v) || 0);
    const r = Math.sqrt(x * x + y * y + z * z);
    return r > 0 ? r : fallback;
  } catch (e) {
    return fallback;
  }
}

// ================== Main SpaceView ==================
export default function SpaceView({ satellites = [], setSatellites }) {
  const [satState, setSatState] = useState([]);

  useEffect(() => {
    let intervalId;

    // If parent provides satellites (simulation / SpaceModeSim), use them directly
    if (satellites && satellites.length > 0) {
      const converted = satellites.map((sat, idx) => {
        const orbitRadius =
          sat.orbitRadius || computeRadiusFromPosition(sat.position) || 42000;
        return {
          id: sat.id || sat.name || `sat-${idx}`,
          name: sat.name || sat.id || `sat-${idx}`,
          orbitRadius,
          status: sat.status || (sat.health ? "OK" : "UNKNOWN"),
          position: sat.position || null,
          health: sat.health,
          linkQuality: sat.linkQuality,
          lastTelemetry: sat.lastTelemetry,
        };
      });
      setSatState(converted);
      // only sync to parent if parent setter exists and data differs
      if (typeof setSatellites === "function") {
        setSatellites((prev = []) => {
          // shallow compare length and first id to avoid unnecessary updates
          if (!Array.isArray(prev) || prev.length !== converted.length || (converted[0] && prev[0]?.id !== converted[0].id)) {
            return converted;
          }
          return prev;
        });
      }
    } else {
      // else: poll backend every 5s
      const fetchAndSet = async () => {
        try {
          const res = await fetch("https://geoshield-1.onrender.com/live_satellites");
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const sats = Object.entries(data || {}).map(([name, sat], idx) => {
            const pos =
              sat.position || sat.predicted_position || sat.predictedPosition || null;
            const orbitRadius =
              sat.orbitRadius || computeRadiusFromPosition(pos) || 42000;
            return {
              id: name,
              name: sat.name || name,
              orbitRadius,
              status: sat.status || "OK",
              position: pos,
              health: sat.health,
              linkQuality: sat.linkQuality,
              lastTelemetry: sat.lastTelemetry || sat.telemetry,
            };
          });
          setSatState(sats);
          if (typeof setSatellites === "function") {
            setSatellites(sats);
          }
        } catch (err) {
          console.error("SpaceView: failed to fetch satellites:", err);
        }
      };

      fetchAndSet();
      intervalId = setInterval(fetchAndSet, 5000); // poll every 5s
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [satellites, setSatellites]);

  return (
    <Canvas camera={{ position: [0, 5, 12], fov: 45 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={1.2} />

      <group rotation={[0, Math.PI, 0]}>
        <Globe />
      </group>

      {/* Wrap models in Suspense so GLTF loading won't break the canvas render */}
      <Suspense fallback={null}>
        {satState.map((sat, idx) => {
          const baseRadius = sat.orbitRadius / 4000;
          const spacedRadius = baseRadius + idx * 0.5;

          return (
            <React.Fragment key={sat.id || idx}>
              <Orbit
                radius={spacedRadius}
                color={
                  sat.status === "OK"
                    ? "cyan"
                    : sat.status === "JAMMED"
                    ? "yellow"
                    : sat.status === "SPOOFED"
                    ? "red"
                    : "orange"
                }
              />
              <SatelliteModel
                radius={spacedRadius}
                speed={0.001 + idx * 0.0003}
                modelUrl={"/models/satellite1.glb"}
                scale={0.025}
                name={sat.name}
                status={sat.status}
              />
            </React.Fragment>
          );
        })}
      </Suspense>

      <Asteroids count={25} radius={20} />
      <Stars radius={100} depth={50} count={10000} factor={4} saturation={0} fade />
      <OrbitControls enableZoom enablePan={false} />
    </Canvas>
  );
}
