import header from './header.module.css'
import { useLocation } from "react-router-dom";

export default function Header() {

    const location = useLocation();

    let pageTitle = "";
    switch (location.pathname) {
        case "/":
            pageTitle = "Patient Vitals";
            break;
        case "/Account":
            pageTitle = "Account Management";
            break;
        case "/wardB":
            pageTitle = "Ward B";
            break;
        case "/settings":
            pageTitle = "Settings";
            break;
        default:
            pageTitle = "Patient Vitals";
    }
    return (
        <header className={header.topbar}>
            <div className={header.brand}>{pageTitle}</div>
            <div className={header.right}>
                {location.pathname === "/" ? "Dashboard" : "Hospital System"}
            </div>
        </header>
    )
}