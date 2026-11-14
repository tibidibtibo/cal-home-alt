from fastapi import FastAPI, Form, Request
from fastapi.responses import JSONResponse
import uvicorn
import json

app = FastAPI()

# Mock data
shutters = [
    {
        "id": "shutter_1",
        "name": "Baie vitrée",
        "type": "Rolling_Shutter",
        "status": [
            {"name": "status", "value": "open", "time": "Sat May 23 12:49:59 2026\n"},
            {"name": "level", "value": "100", "time": "Sat May 23 12:49:59 2026\n"},
            {"name": "hasTilt", "value": "false", "time": "Sat May 23 12:49:59 2026\n"}
        ]
    },
    {
        "id": "shutter_2",
        "name": "BSO Salon",
        "type": "Rolling_Shutter",
        "status": [
            {"name": "status", "value": "middle", "time": "Sat May 23 12:49:59 2026\n"},
            {"name": "level", "value": "50", "time": "Sat May 23 12:49:59 2026\n"},
            {"name": "hasTilt", "value": "true", "time": "Sat May 23 12:49:59 2026\n"},
            {"name": "tilt", "value": "45", "time": "Sat May 23 12:49:59 2026\n"}
        ]
    }
]

@app.post("/m")
async def box_api(a: str, request: Request):
    if a == "getObjects":
        return {"objects": shutters}

    if a == "command":
        form_data = await request.form()
        device_id = form_data.get("id")
        action = form_data.get("action")
        args_str = form_data.get("args")

        # Update mock data
        for s in shutters:
            if s["id"] == device_id:
                if action == "OPEN":
                    for item in s["status"]:
                        if item["name"] == "status": item["value"] = "open"
                        if item["name"] == "level": item["value"] = "100"
                elif action == "CLOSE":
                    for item in s["status"]:
                        if item["name"] == "status": item["value"] = "close"
                        if item["name"] == "level": item["value"] = "0"
                elif action == "STOP":
                    for item in s["status"]:
                        if item["name"] == "status": item["value"] = "middle"
                elif action == "LEVEL":
                    args = json.loads(args_str)
                    level = args.get("level")
                    for item in s["status"]:
                        if item["name"] == "level": item["value"] = str(level)
                        if item["name"] == "status":
                            if level == "0": item["value"] = "close"
                            elif level == "100": item["value"] = "open"
                            else: item["value"] = "middle"
                elif action == "TILT":
                    args = json.loads(args_str)
                    angle = args.get("angle")
                    for item in s["status"]:
                        if item["name"] == "tilt": item["value"] = str(angle)
                return {"ok": True}

        return JSONResponse(status_code=404, content={"ok": False, "error": "Device not found"})

    return JSONResponse(status_code=400, content={"error": "Invalid action"})

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)
