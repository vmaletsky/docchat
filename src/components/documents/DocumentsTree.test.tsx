// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DocumentsTree, type DocumentItem } from "./DocumentsTree";

function mockDocuments(docs: DocumentItem[]) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = input.toString();
    if (url.includes("/api/documents")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(docs),
      } as Response);
    }
    if (url.includes("/api/conversations")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  }) as unknown as typeof fetch;
}

describe("DocumentsTree status indicators", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders an error indicator with the error message as a tooltip", async () => {
    mockDocuments([
      {
        id: "doc-1",
        name: "broken.pdf",
        status: "error",
        errorMessage: "Could not extract text from PDF",
        createdAt: new Date().toISOString(),
      },
    ]);

    render(<DocumentsTree />);

    const icon = await screen.findByTestId("status-icon-error");
    expect(icon.closest("[title]")).toHaveAttribute(
      "title",
      "Could not extract text from PDF"
    );
  });

  it("renders a generic error indicator without crashing when errorMessage is null", async () => {
    mockDocuments([
      {
        id: "doc-2",
        name: "broken-no-message.pdf",
        status: "error",
        errorMessage: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    render(<DocumentsTree />);

    const icon = await screen.findByTestId("status-icon-error");
    expect(icon.closest("[title]")).toHaveAttribute(
      "title",
      "Failed to process document"
    );
  });

  it("renders normally for a ready document", async () => {
    mockDocuments([
      {
        id: "doc-3",
        name: "ready.pdf",
        status: "ready",
        createdAt: new Date().toISOString(),
      },
    ]);

    render(<DocumentsTree />);

    expect(await screen.findByTestId("status-icon-ready")).toBeInTheDocument();
    expect(screen.getByText("ready.pdf")).toBeInTheDocument();
  });

  it("renders a loading indicator for a processing document", async () => {
    mockDocuments([
      {
        id: "doc-4",
        name: "processing.pdf",
        status: "processing",
        createdAt: new Date().toISOString(),
      },
    ]);

    render(<DocumentsTree />);

    expect(
      await screen.findByTestId("status-icon-processing")
    ).toBeInTheDocument();
  });
});
