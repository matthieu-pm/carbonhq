import XCTest

final class AgentTests: XCTestCase {
    func testGenericAgentSettingsAndTurnLock() throws {
        continueAfterFailure = false
        let env = ProcessInfo.processInfo.environment
        guard let url = env["CARBON_ACP_URL"], let token = env["CARBON_ACP_TOKEN"] else {
            throw XCTSkip("set TEST_RUNNER_CARBON_ACP_URL and TEST_RUNNER_CARBON_ACP_TOKEN for the ACP UI fixture")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-servers", "", "-new.harness", "acp:ios-fixture"]
        app.launch()
        app.buttons["Add server"].firstMatch.tap()
        app.textFields["Address"].tap()
        app.textFields["Address"].typeText(url)
        app.textFields["Token"].tap()
        app.textFields["Token"].typeText(token)
        XCTAssertTrue(app.buttons["Add"].isEnabled)
        app.buttons["Add"].tap()
        let new = app.buttons["New session"].firstMatch
        XCTAssertTrue(new.waitForExistence(timeout: 15))
        new.tap()
        let prompt = app.textFields["Prompt"]
        XCTAssertTrue(prompt.waitForExistence(timeout: 15))
        app.swipeUp()
        pick(app, "Thinking", "Minimal")
        pick(app, "Mode", "Plan")
        XCTAssertFalse(row(app, "Permissions").exists)
        XCTAssertFalse(row(app, "Effort").exists)
        XCTAssertFalse(app.switches["Fast mode"].exists)
        snap(app, "ACP-new-session-options")
        app.swipeDown()
        prompt.tap()
        prompt.typeText("READY")
        app.buttons["Start"].tap()
        XCTAssertTrue(app.staticTexts["ACP_READY"].waitForExistence(timeout: 20))

        let settings = app.buttons["Agent settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 15))
        settings.tap()
        expectValue(app, "Thinking", "Minimal")
        expectValue(app, "Mode", "Plan")
        pick(app, "Thinking", "Adaptive")
        expectValue(app, "Thinking", "Adaptive")
        pick(app, "Mode", "Unavailable mode")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Mode refused'")).firstMatch.waitForExistence(timeout: 5))
        expectValue(app, "Mode", "Plan")
        snap(app, "ACP-rejected-mode")
        app.buttons["Done"].tap()

        let message = app.textFields["Message"]
        message.tap()
        message.typeText("HOLD")
        app.buttons["Send"].tap()
        XCTAssertTrue(app.buttons["Stop"].waitForExistence(timeout: 15))
        settings.tap()
        XCTAssertTrue(app.staticTexts["Agent settings cannot change during a turn."].waitForExistence(timeout: 5))
        XCTAssertFalse(row(app, "Thinking").isEnabled)
        snap(app, "ACP-controls-locked")
        app.buttons["Done"].tap()
        app.buttons["Stop"].tap()
    }

    private func row(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", label, label + ",")).firstMatch
    }

    private func pick(_ app: XCUIApplication, _ label: String, _ value: String) {
        let picker = row(app, label)
        XCTAssertTrue(picker.waitForExistence(timeout: 10))
        picker.tap()
        let option = app.buttons[value]
        XCTAssertTrue(option.waitForExistence(timeout: 5))
        option.tap()
    }

    private func expectValue(_ app: XCUIApplication, _ label: String, _ value: String) {
        let applied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", value), object: row(app, label))
        XCTAssertEqual(XCTWaiter.wait(for: [applied], timeout: 5), .completed)
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
