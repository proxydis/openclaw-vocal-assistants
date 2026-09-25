document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("code"), msg = document.getElementById("msg");
  const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: input.value }) });
  if (res.ok) { location.href = "/"; return; }
  msg.textContent = res.status === 429 ? "Trop d’essais — patientez" : "Code incorrect";
  input.value = ""; input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake");
});
