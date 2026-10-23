// Tiny modal helper. Builds an overlay + content div, returns handles
// for closing. No dependencies.

export function openModal({ title, body, footer, kind }) {
    const root = document.getElementById("modal-root");
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const content = document.createElement("div");
    content.className = `modal-content ${kind === "matrix" ? "modal-matrix" : "modal-form"}`;

    const header = document.createElement("div");
    header.className = "modal-header";
    header.innerHTML = `<h2></h2><span class="spacer"></span><button class="modal-close">×</button>`;
    header.querySelector("h2").textContent = title;
    const closeBtn = header.querySelector(".modal-close");

    const bodyEl = document.createElement("div");
    bodyEl.className = "modal-body";
    if (typeof body === "string") bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);

    content.appendChild(header);
    content.appendChild(bodyEl);

    if (footer) {
        const footerEl = document.createElement("div");
        footerEl.className = "modal-footer";
        if (typeof footer === "string") footerEl.innerHTML = footer;
        else footerEl.appendChild(footer);
        content.appendChild(footerEl);
    }

    overlay.appendChild(content);
    root.appendChild(overlay);

    function close() {
        overlay.remove();
        document.removeEventListener("keydown", onEsc);
    }
    function onEsc(e) {
        if (e.key === "Escape") close();
    }
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onEsc);

    return { close, body: bodyEl, overlay, content };
}
