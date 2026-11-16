import XCTest
@testable import Carbon

final class RecoveryTests: XCTestCase {
    private func event(_ id: String, _ seq: Int = 0) throws -> AgentEvent {
        try JSONDecoder().decode(AgentEvent.self, from: Data("""
        {"id":"\(id)","sessionId":"s","seq":\(seq),"payload":{"type":"assistant_text","text":"\(id)"}}
        """.utf8))
    }

    func testResetKeepsLiveBoundaryUniqueAndLeavesHistoryForPaging() throws {
        var current = Transcript(olderBefore: 10)
        for e in try [event("old", 50), event("tail", 0), event("live", 51)] { current.append(e) }
        let recovered = SessionRecovery(events: try [event("sub", 0), event("tail", 0)], olderBefore: 500, reset: true)
        let next = current.recovering(recovered, held: ["old"])
        XCTAssertEqual(next.events.map(\.id), ["sub", "tail", "live"])
        XCTAssertEqual(next.olderBefore, 500)
    }

    func testReplayPreservesOlderPagesAndOrdersMissedEventsBeforeLiveOutput() throws {
        var current = Transcript(olderBefore: 10)
        for e in try [event("older"), event("held"), event("b"), event("live")] { current.append(e) }
        let recovered = SessionRecovery(events: try [event("a"), event("b")], olderBefore: nil, reset: false)
        let next = current.recovering(recovered, held: ["held"])
        XCTAssertEqual(next.events.map(\.id), ["older", "held", "a", "b", "live"])
        XCTAssertEqual(next.olderBefore, 10)
    }

    func testRecoveryWireDecodesBothOutcomes() throws {
        for reset in [true, false] {
            let decoded = try JSONDecoder().decode(SessionRecovery.self, from: Data("""
            {"events":[],"olderBefore":123,"reset":\(reset)}
            """.utf8))
            XCTAssertEqual(decoded.reset, reset)
            XCTAssertEqual(decoded.olderBefore, 123)
        }
    }
}
