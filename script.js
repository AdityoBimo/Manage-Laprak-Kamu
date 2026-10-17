const STORAGE_KEY = "laprak-tracker-v1";

let courses = loadCourses();
let editingId = null;
let activeCourseId = null;

const $ = (selector) => document.querySelector(selector);

function loadCourses() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCourses() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(courses));
}

function getCourse(id) {
  return courses.find((course) => course.id === id);
}

function completedCount(course) {
  return course.meetings.filter(Boolean).length;
}

function percentage(course) {
  return course.meetings.length
    ? Math.round((completedCount(course) / course.meetings.length) * 100)
    : 0;
}

function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
}

function render() {
  const totalMeetings = courses.reduce(
    (sum, course) => sum + course.meetings.length,
    0,
  );

  const totalDone = courses.reduce(
    (sum, course) => sum + completedCount(course),
    0,
  );

  $("#courseCount").textContent = courses.length;
  $("#doneCount").textContent = `${totalDone}/${totalMeetings}`;
  $("#overallProgress").textContent =
    `${totalMeetings ? Math.round((totalDone / totalMeetings) * 100) : 0}%`;

  const list = $("#courseList");

  if (courses.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <h3>Belum ada mata kuliah</h3>
        <p>Tambah mata kuliah pertama lo buat mulai tracking.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = courses
    .map((course) => {
      const done = completedCount(course);
      const progress = percentage(course);
      const next = course.meetings.indexOf(false);

      return `
      <article class="course-card ${progress === 100 ? "complete" : ""}">
        <div class="course-top">
          <div>
            <h3>${escapeHTML(course.name)}</h3>
            <span class="muted">
              ${done} dari ${course.meetings.length} pertemuan selesai
            </span>
          </div>
          <strong>${progress}%</strong>
        </div>

        <div class="progress-track">
          <div class="progress-bar" style="width:${progress}%"></div>
        </div>

        <span class="muted">
          ${
            progress === 100
              ? "🎉 Semua pertemuan beres!"
              : `Berikutnya: Pertemuan ${next + 1}`
          }
        </span>

        <div class="card-actions">
          <button data-action="open" data-id="${course.id}">Checklist</button>
          <button class="secondary" data-action="edit"
            data-id="${course.id}">Edit</button>
          <button class="secondary" data-action="delete"
            data-id="${course.id}">Hapus</button>
        </div>
      </article>
    `;
    })
    .join("");
}

function openCourseForm(course = null) {
  editingId = course?.id ?? null;

  $("#courseModalTitle").textContent = course
    ? "Edit mata kuliah"
    : "Tambah mata kuliah";

  $("#courseName").value = course?.name ?? "";
  $("#meetingCount").value = course?.meetings.length ?? 14;

  $("#courseModal").classList.add("show");
  $("#courseName").select();
}

function closeCourseForm() {
  $("#courseModal").classList.remove("show");
  $("#courseForm").reset();
  editingId = null;
}

$("#addButton").addEventListener("click", () => openCourseForm());
$("#cancelCourse").addEventListener("click", closeCourseForm);

$("#courseForm").addEventListener("submit", (event) => {
  event.preventDefault();

  const name = $("#courseName").value.trim();
  const count = Number($("#meetingCount").value);

  if (!name || !Number.isInteger(count) || count < 1 || count > 100) {
    alert("Isi nama matkul dan jumlah pertemuan yang valid.");
    return;
  }

  if (editingId) {
    const course = getCourse(editingId);
    const oldMeetings = course.meetings;

    course.name = name;
    course.meetings = Array.from(
      { length: count },
      (_, index) => oldMeetings[index] ?? false,
    );
  } else {
    courses.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name,
      meetings: Array(count).fill(false),
    });
  }

  saveCourses();
  render();
  closeCourseForm();
});

function openMeetings(id) {
  const course = getCourse(id);
  if (!course) return;

  activeCourseId = id;
  $("#meetingTitle").textContent = course.name;
  $("#meetingModal").classList.add("show");

  renderMeetings();
}

function renderMeetings() {
  const course = getCourse(activeCourseId);
  if (!course) return;

  $("#markAll").textContent =
    completedCount(course) === course.meetings.length
      ? "Reset semua"
      : "Tandai semua";

  $("#meetingSummary").textContent =
    `${completedCount(course)} dari ${course.meetings.length} selesai`;

  $("#meetingList").innerHTML = course.meetings
    .map(
      (done, index) => `
    <label class="meeting ${done ? "done" : ""}">
      <input type="checkbox" data-meeting="${index}"
        ${done ? "checked" : ""}>
      <span>Pertemuan ${index + 1}</span>
    </label>
  `,
    )
    .join("");
}

$("#courseList").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  const course = getCourse(id);
  if (!course) return;

  if (action === "open") openMeetings(id);
  if (action === "edit") openCourseForm(course);

  if (action === "delete" && confirm(`Hapus mata kuliah "${course.name}"?`)) {
    courses = courses.filter((item) => item.id !== id);
    saveCourses();
    render();
  }
});

$("#meetingList").addEventListener("change", (event) => {
  const checkbox = event.target;

  if (!checkbox.matches("input[data-meeting]")) return;

  const course = getCourse(activeCourseId);
  if (!course) return;

  course.meetings[Number(checkbox.dataset.meeting)] = checkbox.checked;

  saveCourses();
  render();
  renderMeetings();
});

$("#markAll").addEventListener("click", () => {
  const course = getCourse(activeCourseId);
  if (!course) return;

  const allDone = completedCount(course) === course.meetings.length;
  course.meetings = course.meetings.map(() => !allDone);

  saveCourses();
  render();
  renderMeetings();
});

function closeMeetingModal() {
  $("#meetingModal").classList.remove("show");
  activeCourseId = null;
}

$("#closeMeeting").addEventListener("click", closeMeetingModal);
$("#doneMeeting").addEventListener("click", closeMeetingModal);

$("#courseModal").addEventListener("click", (event) => {
  if (event.target === $("#courseModal")) closeCourseForm();
});

$("#meetingModal").addEventListener("click", (event) => {
  if (event.target === $("#meetingModal")) closeMeetingModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeCourseForm();
  closeMeetingModal();
});

$("#themeButton").addEventListener("click", () => {
  document.body.classList.toggle("dark");

  localStorage.setItem(
    "laprak-theme",
    document.body.classList.contains("dark") ? "dark" : "light",
  );
});

const savedTheme = localStorage.getItem("laprak-theme");

if (
  savedTheme === "dark" ||
  (!savedTheme && matchMedia("(prefers-color-scheme: dark)").matches)
) {
  document.body.classList.add("dark");
}

render();
