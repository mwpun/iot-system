import React, { useEffect, useState } from "react";
import axios from "axios";
import styles from "./AddGrafanaUrl.module.css";
import Navbar from "./component/navbar.jsx";
import Header from "./component/header.jsx";
import { API_URL } from "./config/apiConfig";

export default function AddGrafanaUrl() {
  const [roomId, setRoomId] = useState("");
  const [sensor, setSensor] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [editId, setEditId] = useState(null);

  const getAuthHeader = () => {
    const token = localStorage.getItem("token");
    return { Authorization: `Bearer ${token}` };
  };

  const resetForm = () => {
    setRoomId("");
    setSensor("");
    setUrl("");
    setEditId(null);
  };

  const loadRooms = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/getRooms`, {
        headers: getAuthHeader(),
      });
      setRooms(res.data || []);
    } catch (err) {
      console.error(err);
      setStatus("โหลดข้อมูลห้องไม่สำเร็จ");
    }
  };

  const loadDashboard = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/getDashboardFull`, {
        headers: getAuthHeader(),
      });
      setRows(res.data || []);
    } catch (err) {
      console.error(err);
      setStatus("โหลดข้อมูลไม่สำเร็จ");
    }
  };

  useEffect(() => {
    loadRooms();
    loadDashboard();
  }, []);

  const validate = () => {
    if (!roomId) return "กรุณาเลือกห้อง";
    if (!sensor.trim()) return "กรุณากรอกชื่อ Sensor";
    if (!url.trim()) return "กรุณากรอก URL Grafana";
    // if (!urlRegex.test(url)) return "รูปแบบ URL ไม่ถูกต้อง";

    const dup = rows.some(
      (r) =>
        String(r.ROOMID) === String(roomId) &&
        r.DEVICE_NAME?.trim() === sensor.trim() &&
        String(r.ID) !== String(editId)
    );

    if (dup) return "รายการนี้ถูกบันทึกไว้แล้ว";

    return "";
  };

  const onSave = async (e) => {
    e.preventDefault();
    const err = validate();

    if (err) {
      setStatus(err);
      return;
    }

    try {
      if (editId) {
        await axios.put(
          `${API_URL}/api/updateDashboard/${editId}`,
          {
            roomId,
            sensorName: sensor.trim(),
            grafanaUrl: url.trim(),
          },
          {
            headers: getAuthHeader(),
          }
        );
        setStatus("แก้ไขสำเร็จ");
      } else {
        await axios.post(
          `${API_URL}/api/addDashboard`,
          {
            roomId,
            sensorName: sensor.trim(),
            grafanaUrl: url.trim(),
          },
          {
            headers: getAuthHeader(),
          }
        );
        setStatus("บันทึกสำเร็จ");
      }

      resetForm();
      loadDashboard();
    } catch (error) {
      console.error(error);
      setStatus(error?.response?.data?.message || "บันทึกข้อมูลไม่สำเร็จ");
    }
  };

  const onCancel = () => {
    resetForm();
    setStatus("ยกเลิกการกรอก");
  };

  const onEdit = (row) => {
    setEditId(row.ID);
    setRoomId(String(row.ROOMID));
    setSensor(row.DEVICE_NAME || "");
    setUrl(row.GRAFANA_URL || "");
    setStatus(`กำลังแก้ไขรายการ ID ${row.ID}`);
  };

  const onDelete = async (id) => {
    try {
      await axios.delete(`${API_URL}/api/deleteDashboard/${id}`, {
        headers: getAuthHeader(),
      });

      if (String(editId) === String(id)) {
        resetForm();
      }

      setStatus("ลบรายการแล้ว");
      loadDashboard();
    } catch (error) {
      console.error(error);
      setStatus(error?.response?.data?.message || "ลบข้อมูลไม่สำเร็จ");
    }
  };

  return (
    <div className={styles.shell}>
      <Header />
      <div className={styles.body}>
        <Navbar />

        <main className={styles.main}>
          <div className={styles.page}>
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <h1 className={styles.title}>
                    {editId ? "แก้ไข URL Grafana" : "เพิ่ม URL Grafana"}
                  </h1>
                  <p className={styles.subtitle}>
                    จัดการลิงก์ Grafana แยกตามห้องและ Sensor
                  </p>
                </div>
              </div>

              <form onSubmit={onSave} className={styles.form}>
                <div className={styles.formGroup}>
                  <label className={styles.label}>ชื่อห้อง</label>
                  <select
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    className={styles.input}
                  >
                    <option value="">-- เลือกห้อง --</option>
                    {rooms.map((room) => (
                      <option key={room.ID} value={room.ID}>
                        {room.NAME}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.label}>ชื่อ Sensor</label>
                  <input
                    value={sensor}
                    onChange={(e) => setSensor(e.target.value)}
                    placeholder="เช่น Device 1"
                    className={styles.input}
                    type="text"
                  />
                </div>

                <div className={`${styles.formGroup} ${styles.fullWidth}`}>
                  <label className={styles.label}>URL Grafana</label>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://grafana.example.com/..."
                    className={styles.input}
                    type="text"
                  />
                </div>

                <div className={styles.buttonGroup}>
                  <button type="submit" className={styles.saveBtn}>
                    {editId ? "Update" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={onCancel}
                    className={styles.cancelBtn}
                  >
                    Cancel
                  </button>
                </div>
              </form>

              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>Status</span>
                <span
                  className={`${styles.statusBadge} ${
                    status
                      ? status === "บันทึกสำเร็จ" || status === "แก้ไขสำเร็จ"
                        ? styles.success
                        : styles.warning
                      : styles.neutral
                  }`}
                >
                  {status || "-"}
                </span>
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.tableHeader}>
                <h2 className={styles.tableTitle}>รายการ URL Grafana</h2>
                <span className={styles.countBadge}>
                  ทั้งหมด {rows.length} รายการ
                </span>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Room Name</th>
                      <th>Sensor Name</th>
                      <th>URL Grafana</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan="4" className={styles.empty}>
                          ยังไม่มีข้อมูล
                        </td>
                      </tr>
                    ) : (
                      rows.map((r) => (
                        <tr key={r.ID}>
                          <td>{r.ROOM_NAME}</td>
                          <td>{r.DEVICE_NAME}</td>
                          <td className={styles.urlCell}>
                            <a
                              href={r.GRAFANA_URL}
                              target="_blank"
                              rel="noreferrer"
                              className={styles.urlLink}
                            >
                              {r.GRAFANA_URL}
                            </a>
                          </td>
                          <td>
                            <div className={styles.actionGroup}>
                              <button
                                type="button"
                                onClick={() => onEdit(r)}
                                className={styles.editBtn}
                              >
                                แก้ไข
                              </button>
                              <button
                                type="button"
                                onClick={() => onDelete(r.ID)}
                                className={styles.deleteBtn}
                              >
                                ลบ
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}