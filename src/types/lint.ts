export interface LSPInput {
  command: string;
  arguments: any;
  eventFilter?: (event: LSPEvent) => boolean;
}

export interface LSPRequest {
  seq: number;
  type: string;
  command: string;
  arguments: any;
}

export interface LSPResponse {
  seq: number;
  type: "response";
  command: string;
  request_seq: number;
  success: boolean;
  body?: any;
}

export interface LSPEventReqComplete {
  seq: number;
  type: "event";
  event: "requestCompleted";
  body: {
    request_seq: number;
  };
}

export interface LSPEvent {
  seq: number;
  type: "event";
  event: string;
  body: any;
}

export interface ActiveRequest {
  eventHandler?: {
    events: LSPEvent[];
    filter: (event: LSPEvent) => boolean;
  };
  request: LSPRequest;
  callback: (response: LSPResponse, events: LSPEvent[]) => void;
}
