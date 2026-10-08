/** Error body the React UI already reads: `{ detail }` on 4xx and 502. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export class ErrorBody {
  static from(err: unknown): Response {
    if (err instanceof HttpError) {
      return Response.json({ detail: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ detail: "Internal server error" }, { status: 500 });
  }
}

/** Pydantic used to reject a missing, empty, or over-long string with 422. */
export class JsonRequest {
  static async object(request: Request): Promise<Record<string, unknown>> {
    let text: string;
    try {
      text = await request.text();
    } catch {
      throw new HttpError(422, "Invalid JSON");
    }
    if (text.trim() === "") throw new HttpError(422, "Invalid JSON");
    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new HttpError(422, "Invalid JSON");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new HttpError(422, "Expected a JSON object");
    }
    return data as Record<string, unknown>;
  }

  static boundedString(body: Record<string, unknown>, field: string, maxLength: number): string {
    const value = body[field];
    if (typeof value !== "string") {
      throw new HttpError(422, `${field}: expected a string`);
    }
    if (value.length < 1) {
      throw new HttpError(422, `${field}: string should have at least 1 character`);
    }
    if (value.length > maxLength) {
      throw new HttpError(422, `${field}: string should have at most ${maxLength} characters`);
    }
    return value;
  }
}
