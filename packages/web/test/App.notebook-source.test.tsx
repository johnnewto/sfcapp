// @vitest-environment jsdom

import { render, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  App,
  getNotebookSourceEditor,
  getNotebookSourceTextArea,
  screen,
  openNotebookSourceEditor,
  setNotebookSourceValue,
  setupAppTestEnv,
  userEvent
} from "./appTestUtils";
import { notebookToCompactYaml, notebookToJson } from "../src/notebook/document";
import {
  compressNotebookSharePayload,
  NOTEBOOK_SHARE_CELL_QUERY_PARAM,
  NOTEBOOK_SHARE_QUERY_PARAM
} from "../src/notebook/notebookShareLink";
import {
  CUSTOM_NOTEBOOK_STORAGE_KEY,
  IMPORTED_NOTEBOOK_VARIANT_ID
} from "../src/notebook/notebookVariants";
import { createNotebookFromTemplate } from "../src/notebook/templates";

setupAppTestEnv();

describe("App notebook source and import workflows", () => {
  it("keeps the source panel on YAML and offers Export JSON", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await openNotebookSourceEditor(user);

    expect(getNotebookSourceEditor()).toBeInTheDocument();
    expect(getNotebookSourceTextArea().value).toContain("format: sfcr-notebook-yaml");
    expect(getNotebookSourceTextArea().value).toContain("title: BMW Browser Notebook");
    expect(screen.getByRole("button", { name: /^save yaml$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^export json$/i })).toBeInTheDocument();
    expect(document.querySelector(".notebook-code-editor .cm-scroller")).toBeTruthy();
  }, 15000);

  it("renders and previews notebook YAML from the editor tab by default", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    expect(screen.getByRole("tab", { name: /^contents$/i })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: /^editor$/i }));

    expect(screen.getByRole("tab", { name: /^editor$/i })).toHaveAttribute("aria-selected", "true");

    const textarea = getNotebookSourceTextArea();

    expect(textarea.value).toContain("format: sfcr-notebook-yaml");
    expect(textarea.value).toContain("title: BMW Browser Notebook");
    expect(textarea.value).toContain("  - equations:");
    expect(textarea.value).toContain('        - [Ls, lag(Ls) + d(Ld) * dt, "Supply of bank loans", $, stock, accumulation]');

    setNotebookSourceValue(textarea.value.replace("BMW Browser Notebook", "JSON Notebook"));
    await user.click(screen.getByRole("button", { name: /preview import/i }));

    expect(screen.getByRole("tab", { name: /^editor$/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      /previewed notebook yaml\. apply to replace the current notebook\./i
    );
    expect(screen.getByRole("region", { name: /notebook source validation/i })).toHaveTextContent(
      /preview is ready\. use apply preview to replace the current notebook\./i
    );
    expect(screen.getByRole("button", { name: /apply preview/i })).toBeInTheDocument();
  }, 15000);

  it("highlights the selected notebook cell in the JSON source editor without switching tabs", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const overviewHeading = screen.getByRole("heading", { name: /^overview$/i });
    const overviewArticle = overviewHeading.closest("article");
    expect(overviewArticle).not.toBeNull();
    if (!(overviewArticle instanceof HTMLElement)) {
      throw new Error("Expected overview notebook cell article.");
    }

    await user.click(overviewArticle);

    expect(screen.getByRole("tab", { name: /^contents$/i })).toHaveAttribute("aria-selected", "true");
    expect(overviewArticle.className).toContain("notebook-cell-is-selected");

    await user.click(screen.getByRole("tab", { name: /^editor$/i }));

    await waitFor(() => {
      expect(document.querySelector(".notebook-source-selected-cell-line")).not.toBeNull();
    });
  });

  it("shows live schema validation and blocks applying invalid YAML", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await openNotebookSourceEditor(user);
    const textarea = getNotebookSourceTextArea();

    // Keep a valid YAML envelope so the failure lands in schema validation (not header parse).
    setNotebookSourceValue(textarea.value.replace("  - markdown:\n", "  - not-a-real-cell:\n"));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /notebook source validation/i })).toHaveTextContent(
        /schema validation failed/i
      );
      expect(screen.getByRole("button", { name: /apply text/i })).toBeDisabled();
    });
  }, 30000);

  it("shows detailed model validation issues for invalid notebook YAML", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await openNotebookSourceEditor(user);
    const textarea = getNotebookSourceTextArea();

    // Compact equation rows are [name, expression, ...]. Use a quoted empty expression so YAML
    // still parses and model validation can report the missing expression.
    setNotebookSourceValue(textarea.value.replace(/\[Cs, Cd,/, '[Cs, "",'));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /notebook source validation/i })).toHaveTextContent(
        /equation expression is required/i
      );
      expect(screen.getByRole("button", { name: /apply text/i })).toBeDisabled();
    });
  }, 30000);

  it("persists dependency toolbar choices into the notebook document", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const sequenceHeading = screen.getByRole("heading", { name: /bmw equation dependency graph/i });
    const sequenceCell = sequenceHeading.closest("article");
    expect(sequenceCell).not.toBeNull();
    if (!(sequenceCell instanceof HTMLElement)) {
      throw new Error("Expected BMW equation dependency graph article.");
    }

    const showButton = within(sequenceCell).queryByRole("button", { name: /^show$/i });
    if (showButton) {
      await user.click(showButton);
    }

    expect(within(sequenceCell).getByRole("button", { name: /show exogenous/i })).toBeInTheDocument();

    await user.click(within(sequenceCell).getByRole("button", { name: /show exogenous/i }));

    await openNotebookSourceEditor(user);

    const exportArea = getNotebookSourceTextArea();
    expect(exportArea.value).toMatch(/showExogenous:\s*true/);
  }, 15000);

  it("renders notebook YAML in the source editor", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await openNotebookSourceEditor(user);

    expect(getNotebookSourceTextArea().value).toMatch(/format: sfcr-notebook-yaml/i);
    expect(getNotebookSourceTextArea().value).toMatch(/title: BMW Browser Notebook/i);
    expect(getNotebookSourceTextArea().value).toMatch(/  - equations:/i);
    expect(getNotebookSourceTextArea().value).toMatch(
      /- \[Ls, lag\(Ls\) \+ d\(Ld\) \* dt, "Supply of bank loans", \$, stock, accumulation\]/i
    );
    expect(getNotebookSourceTextArea().value).toMatch(/method: newton/i);
    expect(document.querySelector(".notebook-code-editor .cm-scroller")).toBeTruthy();
  });

  it("auto-detects Markdown during preview import from the YAML editor", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await openNotebookSourceEditor(user);
    const markdownSource = [
      "# Markdown Import Notebook",
      "",
      "## Overview",
      "",
      "Hello from markdown.",
      ""
    ].join("\n");
    setNotebookSourceValue(markdownSource);
    await user.click(screen.getByRole("button", { name: /preview import/i }));

    expect(screen.getByRole("tab", { name: /^editor$/i })).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getAllByText((_, node) => node?.textContent?.includes("Types: markdown") ?? false).length
    ).toBeGreaterThan(0);
  }, 15000);

  it("previews edited YAML from the source editor", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const yamlSource = notebookToCompactYaml(createNotebookFromTemplate("bmw"), { preserveIds: true }).replace(
      "BMW Browser Notebook",
      "YAML Notebook"
    );

    await openNotebookSourceEditor(user);
    setNotebookSourceValue(yamlSource);
    await user.click(screen.getByRole("button", { name: /preview import/i }));

    expect(screen.getByRole("tab", { name: /^editor$/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      /previewed notebook yaml\. apply to replace the current notebook\./i
    );
    expect(screen.getAllByText(/YAML Notebook/i).length).toBeGreaterThan(0);
  }, 15000);

  it("previews and applies imported notebook JSON before replacing the document", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await openNotebookSourceEditor(user);

    const nextValue = notebookToJson(createNotebookFromTemplate("bmw")).replace(
      "BMW Browser Notebook",
      "Imported Notebook"
    );
    setNotebookSourceValue(nextValue);
    await user.click(screen.getByRole("button", { name: /preview import/i }));

    expect(screen.getByRole("tab", { name: /^editor$/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText(/Imported Notebook/i).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: /apply preview/i })[0]);

    expect(screen.getAllByText(/^Imported Notebook$/i).length).toBeGreaterThan(0);
  }, 15000);

  it("saves an applied custom notebook to browser storage", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await openNotebookSourceEditor(user);

    const textarea = getNotebookSourceTextArea();
    const customSource = textarea.value.replace("BMW Browser Notebook", "Stored Custom Notebook");

    setNotebookSourceValue(customSource);
    await user.click(screen.getByRole("button", { name: /preview import/i }));
    await user.click(screen.getAllByRole("button", { name: /apply preview/i })[0]);

    await waitFor(() => {
      expect(
        window.localStorage.getItem(`sfcr:notebook-variant:${IMPORTED_NOTEBOOK_VARIANT_ID}`)
      ).toContain("Stored Custom Notebook");
    });
    expect(screen.getByRole("combobox", { name: /notebook template/i })).toHaveValue(
      IMPORTED_NOTEBOOK_VARIANT_ID
    );
  }, 15000);

  it("recalls a saved custom notebook from the template selector", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";
    const customNotebook = createNotebookFromTemplate("bmw");
    customNotebook.title = "Recalled Custom Notebook";
    customNotebook.metadata = { version: 1 };
    window.localStorage.setItem(CUSTOM_NOTEBOOK_STORAGE_KEY, notebookToJson(customNotebook));

    render(<App />);

    const templatePicker = screen.getByRole("combobox", { name: /notebook template/i });
    expect(templatePicker).toHaveValue("bmw");
    expect(within(templatePicker).getByRole("option", { name: /recalled custom notebook/i })).toBeInTheDocument();

    await user.selectOptions(templatePicker, IMPORTED_NOTEBOOK_VARIANT_ID);

    expect(screen.getAllByText(/^Recalled Custom Notebook$/i).length).toBeGreaterThan(0);
    expect(templatePicker).toHaveValue(IMPORTED_NOTEBOOK_VARIANT_ID);
  }, 15000);

  it("opens the editor tab from the template selector File option", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    const templatePicker = screen.getByRole("combobox", { name: /notebook template/i });
    expect(templatePicker).toHaveValue("bmw");
    expect(screen.getByRole("tab", { name: /^contents$/i })).toHaveAttribute("aria-selected", "true");

    await user.selectOptions(
      templatePicker,
      within(templatePicker).getByRole("option", { name: /^file/i })
    );

    expect(screen.getByRole("tab", { name: /^editor$/i })).toHaveAttribute("aria-selected", "true");
    expect(templatePicker).toHaveValue("bmw");

    const customNotebook = createNotebookFromTemplate("bmw");
    customNotebook.title = "Template Picker File Notebook";
    customNotebook.metadata = { version: 1 };
    const yamlSource = notebookToCompactYaml(customNotebook, { preserveIds: true });
    const file = new File([yamlSource], "picker-import.notebook.yaml", { type: "application/yaml" });
    const fileInput = document.getElementById("notebook-import-file-input");

    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected notebook source file input.");
    }

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(getNotebookSourceTextArea().value).toContain("Template Picker File Notebook");
    });
  }, 15000);

  it("keeps the editor rail open after choosing a notebook file", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await user.click(screen.getByRole("tab", { name: /^editor$/i }));

    const customNotebook = createNotebookFromTemplate("bmw");
    customNotebook.title = "Imported File Notebook";
    customNotebook.metadata = { version: 1 };
    const yamlSource = notebookToCompactYaml(customNotebook, { preserveIds: true });
    const file = new File([yamlSource], "import.notebook.yaml", { type: "application/yaml" });
    const fileInput = document.querySelector('input[type="file"]');

    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected notebook source file input.");
    }

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /^editor$/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tab", { name: /^inspect$/i })).toHaveAttribute("aria-selected", "false");
      expect(getNotebookSourceTextArea().value).toContain("Imported File Notebook");
      expect(screen.getByRole("region", { name: /notebook source validation/i })).toHaveTextContent(
        /preview is ready\. use apply preview to replace the current notebook\./i
      );
    });
    expect(screen.getByRole("button", { name: /apply preview/i })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("button", { name: /apply preview/i })).toBeInTheDocument();
  }, 15000);

  it("routes applied file imports to a variant URL and records the source file name", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/notebook");

    render(<App />);

    await user.click(screen.getByRole("tab", { name: /^editor$/i }));

    const customNotebook = createNotebookFromTemplate("sim");
    customNotebook.title = "Applied File Notebook";
    customNotebook.metadata = { version: 1, template: "sim" };
    const yamlSource = notebookToCompactYaml(customNotebook, { preserveIds: true });
    const file = new File([yamlSource], "browser-notebook.notebook.yaml", { type: "application/yaml" });
    const fileInput = document.querySelector('input[type="file"]');

    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected notebook source file input.");
    }

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /apply preview/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /apply preview/i }));

    await waitFor(() => {
      expect(window.location.pathname).toContain("/notebook/variant/sim-browser-notebook");
      expect(getNotebookSourceTextArea().value).toContain("sourceFileName: browser-notebook.notebook.yaml");
    });
  }, 15000);

  it("imports a JSON notebook file and shows it as YAML in the editor rail", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await openNotebookSourceEditor(user);

    const jsonSource = notebookToJson(createNotebookFromTemplate("bmw")).replace(
      "BMW Browser Notebook",
      "Imported JSON File Notebook"
    );
    const file = new File([jsonSource], "import.notebook.json", { type: "application/json" });
    const fileInput = document.querySelector('input[type="file"]');

    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected notebook source file input.");
    }

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /^editor$/i })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tab", { name: /^inspect$/i })).toHaveAttribute("aria-selected", "false");
      expect(getNotebookSourceTextArea().value).toContain("Imported JSON File Notebook");
      expect(getNotebookSourceTextArea().value).toContain("format: sfcr-notebook-yaml");
    });
  }, 15000);

  it("shows apply and discard actions when the import text is edited", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/notebook";

    render(<App />);

    await openNotebookSourceEditor(user);

    const textarea = getNotebookSourceTextArea();
    const editedValue = textarea.value.replace("BMW Browser Notebook", "Draft Notebook");

    setNotebookSourceValue(editedValue);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /apply text/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /discard text/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /apply text/i }));

    expect(screen.getAllByText(/^Draft Notebook$/i).length).toBeGreaterThan(0);

    const refreshedTextarea = getNotebookSourceTextArea();
    const afterApply = refreshedTextarea.value;
    setNotebookSourceValue(afterApply.replace("Draft Notebook", "BMW Browser Notebook"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /discard text/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /discard text/i }));

    expect(getNotebookSourceTextArea().value).toContain("Draft Notebook");
  }, 15000);

  it("loads a shared notebook from ?nbz= query params and cleans the URL", async () => {
    const sharedDocument = createNotebookFromTemplate("sim");
    sharedDocument.title = "Shared Via URL Notebook";
    const nbz = compressNotebookSharePayload(notebookToJson(sharedDocument));
    const cellId = sharedDocument.cells[0]?.id ?? "intro";
    const search = `?${NOTEBOOK_SHARE_QUERY_PARAM}=${nbz}&${NOTEBOOK_SHARE_CELL_QUERY_PARAM}=${cellId}`;

    window.history.replaceState(null, "", `/#/notebook${search}`);

    render(<App />);

    await waitFor(() => {
      expect(window.location.search).not.toContain(NOTEBOOK_SHARE_QUERY_PARAM);
      expect(screen.getByRole("status")).toHaveTextContent(/loaded shared notebook: shared via url notebook/i);
      expect(screen.getAllByText(/^Shared Via URL Notebook$/i).length).toBeGreaterThan(0);
      expect(window.location.pathname).toContain(`/notebook/variant/${IMPORTED_NOTEBOOK_VARIANT_ID}/${cellId}`);
    });
  }, 15000);
});
