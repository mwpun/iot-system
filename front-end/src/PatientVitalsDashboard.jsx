import styles from "./PatientVitals.module.css";
import Header from "./component/header.jsx";
import Navbar from "./component/navbar.jsx";
import axios from "axios";
import { useState, useEffect, useRef } from "react";
import { API_URL } from "./config/apiConfig";

export default function PatientVitalsDashboard() {
  const [sensors, setSensors] = useState([]);
  const [dashboard, setDashboard] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [grafanaStatus, setGrafanaStatus] = useState({});

  const token = localStorage.getItem("token");
  const lastAlertShownRef = useRef({});
  const grafanaTimerRef = useRef({});

  const getSensorKey = (room, sensorID) => `${room}:${sensorID}`;

  const bedStatusText = (bedstatus) => {
    switch (bedstatus) {
      case 0:
        return "Out of bed";
      case 1:
        return "In bed";
      default:
        return "No Data";
    }
  };

  const sleepStatusText = (sleepstatus) => {
    switch (sleepstatus) {
      case 0:
        return "Deep sleep";
      case 1:
        return "Light sleep";
      case 2:
        return "Awake";
      case 3:
        return "None";
      default:
        return "No Data";
    }
  };

  const alertText = (alertLevel) => {
    switch (alertLevel) {
      case 0:
        return "Normal";
      case 1:
        return "Warning";
      case 2:
        return "Danger";
      default:
        return "No Data";
    }
  };

  const alertClass = (alertLevel) => {
    switch (alertLevel) {
      case 0:
        return `${styles.alert} ${styles.normal}`;
      case 1:
        return `${styles.alert} ${styles.waring}`;
      case 2:
        return `${styles.alert} ${styles.danger}`;
      default:
        return `${styles.alert} ${styles.normal}`;
    }
  };

  const alertBannerClass = (alertLevel) => {
    switch (alertLevel) {
      case 1:
        return `${styles.cardAlertBanner} ${styles.cardAlertWarning}`;
      case 2:
        return `${styles.cardAlertBanner} ${styles.cardAlertDanger}`;
      default:
        return `${styles.cardAlertBanner} ${styles.cardAlertNormal}`;
    }
  };

  const clearGrafanaTimer = (cardKey) => {
    if (grafanaTimerRef.current[cardKey]) {
      clearTimeout(grafanaTimerRef.current[cardKey]);
      delete grafanaTimerRef.current[cardKey];
    }
  };

  const startGrafanaTimeout = (cardKey) => {
    clearGrafanaTimer(cardKey);

    grafanaTimerRef.current[cardKey] = setTimeout(() => {
      setGrafanaStatus((prev) => {
        const current = prev[cardKey];
        if (current && current.loading && !current.loaded) {
          return {
            ...prev,
            [cardKey]: {
              ...(current || {}),
              loading: false,
              loaded: false,
              error: true,
            },
          };
        }
        return prev;
      });
    }, 10000);
  };

  const setGrafanaLoaded = (cardKey) => {
    clearGrafanaTimer(cardKey);
    setGrafanaStatus((prev) => ({
      ...prev,
      [cardKey]: {
        ...(prev[cardKey] || {}),
        loading: false,
        loaded: true,
        error: false,
      },
    }));
  };

  useEffect(() => {
    const evtSource = new EventSource(`${API_URL}/api/sensors/stream`);

    const upsertSensor = (room, sensorID, updater) => {
      setSensors((prev) => {
        const idx = prev.findIndex(
          (s) => s.room === room && s.sensorID === sensorID
        );

        if (idx >= 0) {
          const newArr = [...prev];
          newArr[idx] = updater(newArr[idx]);
          return newArr;
        }

        return [
          ...prev,
          updater({
            room,
            sensorID,
            sensorType: "mmwave",
            data: {},
            alertLevel: 0,
            lastUpdate: null,
            lastAlertAt: null,
            alertBanner: null,
          }),
        ];
      });
    };

    const handleRawEvent = (event) => {
      const payload = JSON.parse(event.data);

      upsertSensor(payload.room, payload.sensorID, (oldSensor) => ({
        ...oldSensor,
        room: payload.room,
        sensorID: payload.sensorID,
        sensorType: payload.sensorType,
        data: payload.data || oldSensor.data || {},
        lastUpdate: payload.timestamp || new Date().toISOString(),
      }));
    };

    const handleAlertEvent = (event) => {
      const payload = JSON.parse(event.data);
      const key = getSensorKey(payload.room, payload.sensorID);
      const lastShownLevel = lastAlertShownRef.current[key];

      upsertSensor(payload.room, payload.sensorID, (oldSensor) => {
        const levelChanged = lastShownLevel !== payload.alertLevel;
        let alertBanner = oldSensor.alertBanner;

        if (payload.alertLevel > 0 && levelChanged) {
          alertBanner = {
            title: payload.alertLevel === 2 ? "Danger Alert" : "Warning Alert",
            message: `Sensor ${payload.sensorID} มีค่าผิดปกติ`,
            heartrate: payload.heartrate ?? "-",
            respiration: payload.respiration ?? "-",
            bedstatus: payload.bedstatus,
            alertLevel: payload.alertLevel,
            timestamp: payload.timestamp || new Date().toISOString(),
          };
        }

        if (payload.alertLevel === 0) {
          alertBanner = null;
        }

        return {
          ...oldSensor,
          room: payload.room,
          sensorID: payload.sensorID,
          alertLevel: payload.alertLevel,
          smoothed: {
            heartrate: payload.heartrate,
            respiration: payload.respiration,
            bedstatus: payload.bedstatus,
            sampleCount: payload.sampleCount,
          },
          lastAlertAt: payload.timestamp || new Date().toISOString(),
          alertBanner,
        };
      });

      lastAlertShownRef.current[key] = payload.alertLevel;
    };

    evtSource.addEventListener("raw", handleRawEvent);
    evtSource.addEventListener("alert", handleAlertEvent);

    evtSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload?.type === "raw") {
          handleRawEvent(event);
          return;
        }

        if (payload?.type === "alert") {
          handleAlertEvent(event);
          return;
        }

        upsertSensor(payload.room, payload.sensorID, (oldSensor) => ({
          ...oldSensor,
          ...payload,
          data: payload.data || oldSensor.data || {},
          alertLevel:
            typeof payload.alertLevel === "number"
              ? payload.alertLevel
              : oldSensor.alertLevel,
        }));
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };

    evtSource.onerror = (err) => {
      console.error("EventSource failed:", err);
    };

    return () => {
      evtSource.close();
      Object.keys(grafanaTimerRef.current).forEach((key) => {
        clearTimeout(grafanaTimerRef.current[key]);
      });
      grafanaTimerRef.current = {};
    };
  }, []);

  const getRooms = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/my-room-access`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRooms(res.data?.rooms || []);
    } catch (err) {
      console.error("getRooms error:", err);
      setRooms([]);
    }
  };

  useEffect(() => {
    getRooms();
  }, []);

  useEffect(() => {
    axios
      .get(`${API_URL}/api/getDashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setDashboard(res.data || []))
      .catch((err) => console.error("getDashboard error:", err));
  }, [token]);

  const allowedRoomNames = rooms.map((r) => r.NAME);

  const updatedSensors = sensors
    .filter((sensor) => allowedRoomNames.includes(sensor.room))
    .map((sensor) => {
      const matchedDashboard = dashboard.find(
        (d) =>
          d.DEVICE_NAME === sensor.sensorID &&
          (d.ROOM_NAME ? d.ROOM_NAME === sensor.room : true)
      );

      if (matchedDashboard) {
        return {
          ...sensor,
          url: matchedDashboard.GRAFANA_URL,
        };
      }

      return sensor;
    });

  useEffect(() => {
    if (rooms.length > 0 && !selectedRoom) {
      setSelectedRoom(rooms[0].NAME);
    } else if (rooms.length === 0) {
      setSelectedRoom(null);
    }
  }, [rooms, selectedRoom]);

  const filteredSensors = updatedSensors.filter((s) => s.room === selectedRoom);

  return (
    <div className={styles.shell}>
      <Header />

      <div className={styles.body}>
        <Navbar />

        <main className={styles.main}>
          <div className={styles.roomList}>
            {rooms.length > 0 ? (
              rooms.map((room) => (
                <span
                  key={room.ID}
                  className={`${styles.roomItem} ${
                    room.NAME === selectedRoom ? styles.activeRoom : ""
                  }`}
                  onClick={() => setSelectedRoom(room.NAME)}
                >
                  {room.NAME.toUpperCase()}
                </span>
              ))
            ) : (
              <p>ไม่มีห้องที่มีสิทธิ์เข้าถึง</p>
            )}
          </div>

          <section className={styles.grid}>
            {!selectedRoom ? (
              <p>ไม่มีห้องที่มีสิทธิ์เข้าถึง</p>
            ) : filteredSensors.length === 0 ? (
              <p>ไม่พบข้อมูลในห้อง {selectedRoom}</p>
            ) : (
              filteredSensors.map((sensor, idx) => {
                const cardKey = getSensorKey(sensor.room, sensor.sensorID);

                const frameState = grafanaStatus[cardKey] || {
                  loading: !!sensor.url,
                  loaded: false,
                  error: false,
                  refreshKey: 0,
                };

                const refreshKey = frameState.refreshKey || 0;

                return (
                  <div key={cardKey || idx} className={styles.card}>
                    <div className={styles.cardHead}>{sensor.sensorID}</div>

                    {sensor.alertBanner && (
                      <div
                        className={alertBannerClass(
                          sensor.alertBanner.alertLevel
                        )}
                      >
                        <div className={styles.cardAlertTop}>
                          <strong>{sensor.alertBanner.title}</strong>
                          <button
                            type="button"
                            className={styles.cardAlertClose}
                            onClick={() => {
                              setSensors((prev) =>
                                prev.map((item) =>
                                  getSensorKey(item.room, item.sensorID) ===
                                  cardKey
                                    ? { ...item, alertBanner: null }
                                    : item
                                )
                              );
                            }}
                          >
                            ×
                          </button>
                        </div>

                        <div className={styles.cardAlertBody}>
                          <div>
                            <b>Sensor:</b> {sensor.sensorID}
                          </div>
                          <div>
                            <b>Heart Rate:</b> {sensor.alertBanner.heartrate}
                          </div>
                          <div>
                            <b>Respiration:</b>{" "}
                            {sensor.alertBanner.respiration}
                          </div>
                          <div>
                            <b>Bed Status:</b>{" "}
                            {bedStatusText(sensor.alertBanner.bedstatus)}
                          </div>
                          <div>
                            <b>Level:</b>{" "}
                            {alertText(sensor.alertBanner.alertLevel)}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className={styles.metricRow}>
                      <div className={styles.metric}>
                        <div className={styles.grafanaFrameWrap}>
                          {sensor.url ? (
                            <>
                              <iframe
                                key={`${cardKey}-${refreshKey}`}
                                src={sensor.url}
                                width="450"
                                height="300"
                                title={`Grafana Dashboard ${sensor.sensorID}`}
                                className={`${styles.grafanaFrame} ${
                                  frameState.loaded
                                    ? styles.grafanaVisible
                                    : styles.grafanaHidden
                                }`}
                                onLoad={() => setGrafanaLoaded(cardKey)}
                              />
                            </>
                          ) : (
                            <div className={styles.grafanaOverlayStatic}>
                              <div className={styles.grafanaErrorIcon}>ℹ</div>
                              <p>ไม่พบ Grafana URL</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={styles.legend}>
                        <h5>Heart Rate</h5>
                        <p>{sensor?.data?.heartrate ?? "-"}</p>

                        <h5>Average Respiration</h5>
                        <p>{sensor?.data?.respiration ?? "-"}</p>

                        <h5>Bed Status</h5>
                        <p>{bedStatusText(sensor?.data?.bedstatus)}</p>

                        <h5>Sleep Status</h5>
                        <p>{sleepStatusText(sensor?.data?.sleepstatus)}</p>

                        <h5>Alert Status</h5>
                        <p className={alertClass(sensor?.alertLevel)}>
                          {alertText(sensor?.alertLevel)}
                        </p>

                        <h5>Last Update</h5>
                        <p>
                          {sensor?.lastUpdate
                            ? new Date(sensor.lastUpdate).toLocaleString()
                            : "-"}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </main>
      </div>
    </div>
  );
}