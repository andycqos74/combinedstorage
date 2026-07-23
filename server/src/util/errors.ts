/** An error that carries an HTTP status code, so routes can translate it directly. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** No connected backend has room for an upload. */
export class InsufficientSpaceError extends HttpError {
  constructor(message = 'Not enough free space across the connected storage backends.') {
    super(507, message); // 507 Insufficient Storage
    this.name = 'InsufficientSpaceError';
  }
}

/** Requested a file/folder/backend that does not exist. */
export class NotFoundError extends HttpError {
  constructor(message = 'Not found.') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

/** The request was well-formed but invalid (bad name, duplicate, etc.). */
export class BadRequestError extends HttpError {
  constructor(message = 'Bad request.') {
    super(400, message);
    this.name = 'BadRequestError';
  }
}
