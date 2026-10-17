const STORAGE_KEY = "laprak-tracker-v1";

let courses = loadCourses();
let editingId = null;
let activeCourseId = null;

const DB_NAME = "laprak-files-v1";
const STORE = "files";
const MAX_FILE = 10 * 1024 * 1024;

let fileCache = [];
let pendingMeeting = null;

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

let dbPromise;

function openDB() {
  dbPromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result
        .createObjectStore(STORE, { keyPath: "id" })
        .createIndex("courseId", "courseId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function tx(mode, run) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const request = run(t.objectStore(STORE));

        t.oncomplete = () => resolve(request?.result);
        t.onerror = t.onabort = () => reject(t.error);
      }),
  );
}

const putFile = (record) => tx("readwrite", (s) => s.put(record));
const removeFile = (id) => tx("readwrite", (s) => s.delete(id));
const filesOfCourse = (id) =>
  tx("readonly", (s) => s.index("courseId").getAll(id));
const allFiles = () => tx("readonly", (s) => s.getAll());

async function deleteFilesWhere(courseId, test) {
  const files = await filesOfCourse(courseId);
  await Promise.all(files.filter(test).map((file) => removeFile(file.id)));
}

function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now() + Math.random());
}

function formatSize(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function updateStorageInfo() {
  try {
    const total = (await allFiles()).reduce((sum, file) => sum + file.size, 0);
    $("#storageInfo").textContent =
      `Total file tersimpan di browser: ${formatSize(total)}`;
  } catch {
    $("#storageInfo").textContent = "";
  }
}

async function loadFiles(id) {
  try {
    const files = await filesOfCourse(id);
    if (activeCourseId !== id) return;
    fileCache = files;
    renderMeetings();
  } catch {
    $("#storageInfo").textContent =
      "Penyimpanan file tidak tersedia di browser ini.";
  }
  updateStorageInfo();
}

function getCourse(id) {
  return courses.find((course) => course.id === id);
}

function completedCount(course) {
  return course.meetings.filter(Boolean).length;
}

function submittedCount(course) {
  return course.meetings.filter(
    (done, index) => done && course.submitted?.[index],
  ).length;
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
      const sent = submittedCount(course);

      return `
      <article class="course-card ${progress === 100 ? "complete" : ""}">
        <div class="course-top">
          <div>
            <h3>${escapeHTML(course.name)}</h3>
            <span class="muted">
              ${done} dari ${course.meetings.length} pertemuan selesai
              · ${sent} dikumpulkan
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
        ${
          done > sent
            ? `<span class="muted pending">${done - sent} belum dikumpulkan</span>`
            : ""
        }

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
    const oldLinks = course.links ?? [];

    course.name = name;
    course.meetings = Array.from(
      { length: count },
      (_, index) => oldMeetings[index] ?? false,
    );
    course.links = Array.from(
      { length: count },
      (_, index) => oldLinks[index] ?? "",
    );
    const oldSubmitted = course.submitted ?? [];
    course.submitted = Array.from({ length: count }, (_, index) =>
      Boolean(oldMeetings[index] && oldSubmitted[index]),
    );
    deleteFilesWhere(course.id, (file) => file.meeting >= count).catch(
      () => {},
    );
  } else {
    courses.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name,
      meetings: Array(count).fill(false),
      links: Array(count).fill(""),
      submitted: Array(count).fill(false),
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

  fileCache = [];
  renderMeetings();
  loadFiles(id);
}

function renderMeetings() {
  const course = getCourse(activeCourseId);
  if (!course) return;

  $("#markAll").textContent =
    completedCount(course) === course.meetings.length
      ? "Reset semua"
      : "Tandai semua";

  $("#meetingSummary").textContent =
    `${completedCount(course)} dari ${course.meetings.length} selesai · ${submittedCount(course)} dikumpulkan`;

  $("#meetingList").innerHTML = course.meetings
    .map((done, index) => {
      const link = course.links?.[index] || "";
      const files = fileCache.filter((file) => file.meeting === index);
      const sent = Boolean(course.submitted?.[index]);

      return `
      <div class="meeting ${done ? "done" : ""}">
        <label class="meeting-check">
          <input type="checkbox" data-meeting="${index}"
            ${done ? "checked" : ""}>
          <span>Pertemuan ${index + 1}</span>
          ${done && !sent ? `<small class="badge">Belum dikumpulkan</small>` : ""}
        </label>

        <div class="meeting-link">
          <label class="submit-pill ${done ? "" : "disabled"}"
            title="${done ? "" : "Selesaikan pertemuan dulu"}">
            <input type="checkbox" data-submit="${index}"
              ${sent ? "checked" : ""} ${done ? "" : "disabled"}>
            Dikumpulkan
          </label>
          ${
            link
              ? `<a class="open-link" href="${escapeHTML(link)}"
                 target="_blank" rel="noopener noreferrer">Buka</a>`
              : ""
          }
          <button type="button" class="secondary mini"
            data-link="${index}">${link ? "Ubah" : "+ Link"}</button>
          <button type="button" class="secondary mini"
            data-upload="${index}">Upload</button>
        </div>

        ${
          files.length
            ? `
          <div class="meeting-files">
            ${files
              .map(
                (file) => `
              <span class="file-chip">
                <button type="button" class="file-open"
                  data-file-open="${file.id}"
                  title="${escapeHTML(file.name)}">
                  ${escapeHTML(file.name)} · ${formatSize(file.size)}
                </button>
                <button type="button" class="file-del"
                  data-file-del="${file.id}"
                  aria-label="Hapus file">✕</button>
              </span>
            `,
              )
              .join("")}
          </div>
        `
            : ""
        }
      </div>
    `;
    })
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
    deleteFilesWhere(id, () => true).catch(() => {});
    courses = courses.filter((item) => item.id !== id);
    saveCourses();
    render();
  }
});

$("#meetingList").addEventListener("change", (event) => {
  const checkbox = event.target;

  const isMeeting = checkbox.matches("input[data-meeting]");
  const isSubmit = checkbox.matches("input[data-submit]");
  if (!isMeeting && !isSubmit) return;

  const course = getCourse(activeCourseId);
  if (!course) return;

  course.submitted = Array.from(
    { length: course.meetings.length },
    (_, i) => course.submitted?.[i] ?? false,
  );

  if (isMeeting) {
    const index = Number(checkbox.dataset.meeting);
    course.meetings[index] = checkbox.checked;
    if (!checkbox.checked) course.submitted[index] = false;
  } else {
    const index = Number(checkbox.dataset.submit);
    course.submitted[index] = course.meetings[index] && checkbox.checked;
  }

  saveCourses();
  render();
  renderMeetings();
});

$("#markAll").addEventListener("click", () => {
  const course = getCourse(activeCourseId);
  if (!course) return;

  const allDone = completedCount(course) === course.meetings.length;
  course.meetings = course.meetings.map(() => !allDone);
  if (allDone) course.submitted = course.meetings.map(() => false);

  saveCourses();
  render();
  renderMeetings();
});

function cleanURL(value) {
  const text = value.trim();
  if (!text) return "";

  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

$("#meetingList").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-link]");
  if (!button) return;

  const course = getCourse(activeCourseId);
  if (!course) return;

  const index = Number(button.dataset.link);
  course.links = Array.from(
    { length: course.meetings.length },
    (_, i) => course.links?.[i] ?? "",
  );

  const input = prompt(
    `Tempel link laporan Pertemuan ${index + 1} (kosongkan untuk hapus):`,
    course.links[index],
  );
  if (input === null) return;

  const link = cleanURL(input);
  if (link === null) {
    alert("Link tidak valid. Pakai link yang diawali http:// atau https://");
    return;
  }

  course.links[index] = link;
  saveCourses();
  renderMeetings();
});

$("#meetingList").addEventListener("click", async (event) => {
  const upload = event.target.closest("button[data-upload]");
  const open = event.target.closest("button[data-file-open]");
  const del = event.target.closest("button[data-file-del]");

  if (upload) {
    pendingMeeting = Number(upload.dataset.upload);
    $("#fileInput").click();
  }

  if (open) {
    const file = fileCache.find((item) => item.id === open.dataset.fileOpen);
    if (!file) return;

    const url = URL.createObjectURL(file.blob);
    const viewable = /^(application\/pdf|image\/|text\/)/.test(file.type);

    if (viewable) {
      window.open(url, "_blank", "noopener");
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
    }

    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  if (del) {
    const file = fileCache.find((item) => item.id === del.dataset.fileDel);
    if (!file || !confirm(`Hapus file "${file.name}"?`)) return;

    try {
      await removeFile(file.id);
      fileCache = fileCache.filter((item) => item.id !== file.id);
      renderMeetings();
      updateStorageInfo();
    } catch {
      alert("Gagal menghapus file.");
    }
  }
});

$("#fileInput").addEventListener("change", async (event) => {
  const picked = [...event.target.files];
  event.target.value = "";

  const course = getCourse(activeCourseId);
  if (!course || pendingMeeting === null || !picked.length) return;

  const tooBig = picked.filter((file) => file.size > MAX_FILE);
  const valid = picked.filter((file) => file.size <= MAX_FILE);

  if (tooBig.length) {
    alert(
      `Ukuran maksimal 10 MB per file. Dilewati: ${tooBig.map((f) => f.name).join(", ")}`,
    );
  }

  navigator.storage?.persist?.();

  try {
    for (const file of valid) {
      const record = {
        id: newId(),
        courseId: course.id,
        meeting: pendingMeeting,
        name: file.name,
        type: file.type,
        size: file.size,
        blob: file,
        added: Date.now(),
      };

      await putFile(record);
      fileCache.push(record);
    }
  } catch {
    alert("Gagal menyimpan file. Penyimpanan browser mungkin penuh.");
  }

  renderMeetings();
  updateStorageInfo();
});

function closeMeetingModal() {
  $("#meetingModal").classList.remove("show");
  activeCourseId = null;
  fileCache = [];
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
