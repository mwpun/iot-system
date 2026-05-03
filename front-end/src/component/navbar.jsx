import navbar from "./navbar.module.css";
import { NavLink, useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import axios from "axios";
import { useEffect, useState } from "react";
import { API_URL } from "../config/apiConfig";

const menuConfig = [
  { id: 1, name: "Dashboard", path: "/" },
  { id: 2, name: "Account", path: "/Account" },
  { id: 3, name: "Permission", path: "/Permission" },
  { id: 4, name: "Grafana Url", path: "/GrafanaUrl" },
  { id: 5, name: "Alerts", path: "/Alerts" },
  { id: 6, name: "Patient Data Timeline", path: "/DataTimeline" },
  { id: 7, name: "Config Sensor Alert", path: "/ConfigSensor" },
];

export default function Navbar() {
  const navigation = useNavigate();
  const [allowedMenus, setAllowedMenus] = useState([]);
  const [loading, setLoading] = useState(true);

  const getAuthHeader = () => {
    const token = localStorage.getItem("token");
    return { Authorization: `Bearer ${token}` };
  };

  useEffect(() => {
    const loadMenuAccess = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/my-menu-access`, {
          headers: getAuthHeader(),
        });

        const menuNames = (res.data?.menus || []).map((m) => m.NAME);
        setAllowedMenus(menuNames);
      } catch (err) {
        console.error("โหลดสิทธิ์เมนูไม่สำเร็จ", err);
        setAllowedMenus([]);
      } finally {
        setLoading(false);
      }
    };

    loadMenuAccess();
  }, []);

  const Logout = () => {
    Swal.fire({
      title: "Confirm logout",
      text: "Are you sure you want to log out?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: "OK",
    }).then((result) => {
      if (result.isConfirmed) {
        localStorage.removeItem("token");
        Swal.fire({
          title: "Log out success!",
          text: "Good bye have a nice day.",
          icon: "success",
        });

        navigation("/Login");
      }
    });
  };

  const visibleMenus = menuConfig.filter((menu) =>
    allowedMenus.includes(menu.name)
  );

  return (
    <aside className={navbar.sidebar}>
      <div className={navbar.sectionTitle}>Menu</div>

      <ul className={navbar.menu}>
        {loading ? (
          <li className={navbar.loading}>Loading...</li>
        ) : (
          visibleMenus.map((menu) => (
            <NavLink key={menu.id} to={menu.path} end={menu.path === "/"}>
              {({ isActive }) => (
                <li className={isActive ? navbar.active : ""}>{menu.name}</li>
              )}
            </NavLink>
          ))
        )}

        <button className={navbar.logoutBtn} onClick={Logout}>
          Logout
        </button>
      </ul>
    </aside>
  );
}