import { useEffect } from "react";
import { TeacherClassroom } from "./TeacherClassroom.tsx";
import { StudentJoin } from "./StudentJoin.tsx";
import "./classroom.css";

export default function ClassroomRoute({ student }: { student: boolean }) {
  useEffect(() => {
    // A back/forward cache snapshot must never reveal an earlier account's room.
    const conceal = () =>
      document.documentElement.setAttribute("data-classroom-away", "");
    const resume = (event: PageTransitionEvent) => {
      if (event.persisted) location.reload();
      else document.documentElement.removeAttribute("data-classroom-away");
    };
    window.addEventListener("pagehide", conceal);
    window.addEventListener("pageshow", resume);
    return () => {
      window.removeEventListener("pagehide", conceal);
      window.removeEventListener("pageshow", resume);
      document.documentElement.removeAttribute("data-classroom-away");
    };
  }, []);
  return student ? <StudentJoin /> : <TeacherClassroom />;
}
