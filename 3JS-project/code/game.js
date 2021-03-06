(function (app) {
    app.pi = Math.PI;

    // ======== CONFIG ========
    const isDebugMode = true;
    const isDoubleSize = false;

    var screenWidth = isDoubleSize ? 480 : 240;
    var screenHeight = isDoubleSize ? 640 : 320;

    var debugHUD = document.getElementById("debugHUD");

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(90, screenWidth / screenHeight, 0.1, app.terrain_scaleFactor * 50);
    var player = new THREE.Group();
    var player_startPosition = new THREE.Vector3();

    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(screenWidth, screenHeight);
    renderer.antialiasing = false;

    const clock = new THREE.Clock(true);

    const raycaster = new THREE.Raycaster();
    var raycastTargets = [];

    var gameRunning = false;

    // set background
    var backgroundColor = new THREE.Color(0xfefadd);
    scene.background = app.get_background();
    const fog_color = backgroundColor;
    scene.fog = app.get_fog(fog_color, 10, app.terrain_scaleFactor * 50);

    // ======== START ========
    app.scene_start = function () {
        scene_setup();
        document.body.appendChild(renderer.domElement);
        gameRunning = true;
        TLRSE = new ThreeLiveRawShaderEditor(renderer, camera, scene);
    }

    function scene_setup() {
        // terrain
        scene.add(app.terrainObject.object);
        //if (isDebugMode) app.terrainObject.material.wireframe = true;
        raycastTargets.push(app.terrainObject.rayMesh); // add to raycast targets; don't cast rays to the hi-res terrain mesh!

        // create player
        player_startPosition.set(10, 0, 0);
        player.add(app.get_player(3, 0x00cccc));
        player.position.add(player_startPosition);
        player.add(camera);
        scene.add(player);

        camera.position.set(0, 10, -20);
    }

    // ======== ANIMATE ========
    var deltaTime = 0;
    const forwardSpeed = 20.0;
    var verticalMovement = 0.0, verticalMovement_velocity = 0.0;
    var player_worldPosition = new THREE.Vector3();
    var movingDirection = new THREE.Vector3(0, 0, 0);
    var player_rotation = 0.0;
    var player_rotation_velocity = 0.0;
    var local_rotation_velocity = new THREE.Vector3();
    var player_direction = new THREE.Vector3();

    const terrain_scale = 1 / (100 * app.terrain_scaleFactor);
    var upVector = new THREE.Vector3(0, 1, 0);
    const downVector = new THREE.Vector3(0, -1, 0);
    var terrainShift = new THREE.Vector2(0, 0);
    var terrain_ray_origin = new THREE.Vector3(0.0, 0.0, 0.0);
    var terrain_hitPoint = {};
    var terrain_normalDirection = new THREE.Vector3(0.0, 0.0, 0.0);
    var terrain_steepness = 0.0;

    var directionBox_previousQuaternion = new THREE.Quaternion();

    // animation loop
    function animate() {
        requestAnimationFrame(animate);
        if (!gameRunning) return;
        if (app.terrainObject.normalMapData == null || app.terrainObject.heightMapData == null) return;

        deltaTime = clock.getDelta();
        getFPS(deltaTime);
        deltaTime = Math.min(deltaTime, 0.1); // avoid extreme acceleration during frame drops

        // fly forward
        moveForward(player, forwardSpeed);

        // flight controls
        player_direction.y = Number(app.moveDown) - Number(app.moveUp);
        player_direction.x = Number(app.moveRight) - Number(app.moveLeft);
        player_direction.normalize();

        if (app.moveLeft || app.moveRight) {
            player_rotation -= player_direction.x * 2.0 * deltaTime;
        }
        if (app.moveUp || app.moveDown) {
            verticalMovement = player_direction.y * 70.0 * deltaTime;
        } else {
            verticalMovement = 0;
        }
        verticalMovement_velocity = THREE.Math.lerp(verticalMovement_velocity, verticalMovement, deltaTime * 0.5);

        player_rotation_velocity = THREE.Math.lerp(player_rotation_velocity, player_rotation, deltaTime * 0.5);
        player.rotation.y = player_rotation_velocity;

        camera.rotation.set(-local_rotation_velocity.x * 0.4 + 0.5, app.pi, -local_rotation_velocity.y * 0.5, 'XYZ');

        // animate terrain
        player.getWorldPosition(player_worldPosition);
        app.terrainObject.object.position.set(player_worldPosition.x, -app.terrain_height, player_worldPosition.z);
        app.terrainObject.object.rotation.y = player.rotation.y;
        terrainShift.set(-player_worldPosition.x * terrain_scale, player_worldPosition.z * terrain_scale);
        app.terrainObject.material.uniforms.shift.value = terrainShift;
        app.terrainObject.material.uniforms.worldRotation.value = -app.terrainObject.object.rotation.y;

        // detect collisions with terrain
        terrain_ray_origin.set(player_worldPosition.x, 10, player_worldPosition.z);
        terrain_hitPoint = raycast2terrain(terrain_ray_origin, downVector);
        if (terrain_hitPoint.position.y >= player_worldPosition.y - 4) {
            player.position.y = THREE.Math.lerp(player.position.y, terrain_hitPoint.position.y + 4, 0.3);
        }

        // rotate debug direction box
        if (isDebugMode && directionBox) {
            directionBox.position.set(player_worldPosition.x, terrain_hitPoint.position.y, player_worldPosition.z);
            directionBox_previousQuaternion.copy(directionBox.quaternion);
            directionBox.quaternion.setFromUnitVectors(upVector, terrain_normalDirection);
            directionBox.quaternion.slerp(directionBox_previousQuaternion, 0.5); // smooth rotation

            // output steepness to color
            directionBox.material.color.r = THREE.Math.lerp(directionBox.material.color.r, terrain_steepness, 0.5);
        }

        renderer.render(scene, camera);
    }
    animate();

    function moveForward(object, distance) {
        movingDirection.setFromMatrixColumn(object.matrix, 0);
        movingDirection.crossVectors(object.up, movingDirection);
        movingDirection.y = verticalMovement_velocity;
        object.position.addScaledVector(movingDirection, -distance * deltaTime);
    };

    // ======== RAYCAST ========
    var ray_hitPoint = new THREE.Vector3(0.0, 0.0, 0.0);
    var intersects = [];
    var intersect_uv = {};
    var terrain = {};

    function raycast2terrain(origin, direction) {
        if (raycastTargets.length == 0) return;
        raycaster.set(origin, direction);
        intersects = raycaster.intersectObjects(raycastTargets, false);
        if (intersects.length > 0) {
            for (let i = 0; i < intersects.length; i++) {

                if (intersects[i].object.name == 'terrain_raytarget') {
                    intersect_uv = intersects[i].uv;
                    terrain = get_terrain_height(intersect_uv);
                    ray_hitPoint.set(intersects[i].point.x, terrain.height, intersects[i].point.z);
                    return { position: ray_hitPoint };
                }
            }
        }
    }

    var transformedUV = new THREE.Vector2(0.0, 0.0);;
    var pixelCoord = [0, 0];
    var normalmap_pixel = [0, 0, 0, 0];
    var heightmap_pixel = [0, 0, 0, 0];
    var terrain_height = 0.0;

    function get_terrain_height(uv) {
        transformedUV.copy(transform_UVs(uv, terrainShift, -app.terrainObject.object.rotation.y));
        if (app.terrainObject.heightMap.image) {
            pixelCoord = [transformedUV.x * app.terrainObject.heightMap.image.width, (1 - transformedUV.y) * app.terrainObject.heightMap.image.height];
            normalmap_pixel = app.terrainObject.normalMapData.getImageData(pixelCoord[0], pixelCoord[1], 1, 1).data;
            heightmap_pixel = app.terrainObject.heightMapData.getImageData(pixelCoord[0], pixelCoord[1], 1, 1).data;
        }
        // surface normal based on normal map
        terrain_normalDirection.set(
            normalmap_pixel[0] / 255 * 2.0 - 1.0, // R to X
            normalmap_pixel[2] / 255 * 2.0 - 1.0, // B to Y
            normalmap_pixel[1] / 255 * 2.0 - 1.0); // G to Z
        // terrain steepness
        terrain_steepness = 1.0 - terrain_normalDirection.dot(upVector);

        terrain_height = -app.terrain_height + (heightmap_pixel[0] / 255) * app.terrain_height; // read red channel and multiply by terrain height
        return { height: terrain_height, color: heightmap_pixel };
    }

    // transfered from vertex shader
    const uv_origin = new THREE.Vector2(0.5, 0.5);
    var rotatedUV = new THREE.Vector2(0.0, 0.0);

    function transform_UVs(uv, shift, rotation) {
        rotatedUV.set(uv.x - 0.5, uv.y - 0.5); //move rotation center to center of object
        rotatedUV = rotate2d(rotation, rotatedUV);
        rotatedUV.add(shift); // movement uv shift
        rotatedUV.add(uv_origin); // move uv back to origin
        rotatedUV.x = (rotatedUV.x > 0) ? rotatedUV.x % 1 : 1 + rotatedUV.x % 1;
        rotatedUV.y = (rotatedUV.y > 0) ? rotatedUV.y % 1 : 1 + rotatedUV.y % 1;

        return rotatedUV;
    }

    var roatation_vector = new THREE.Vector2(0.0, 0.0);

    function rotate2d(angle, uv) {
        roatation_vector.set(Math.cos(angle) * uv.x + Math.sin(angle) * uv.y,
            Math.cos(angle) * uv.y - Math.sin(angle) * uv.x);
        return roatation_vector;
    }

    // ======== DEBUG OBJECTS ========
    var directionBox;
    if (isDebugMode) {
        var size = [2, 200, 2];
        for (let i = 0; i < 20; i++) {
            var cube = app.get_cube(size, 0xff0000);
            cube.position.z = -500 + i * 50;
            scene.add(cube);
        }
        var direction_size = [1, 50, 1];
        directionBox = app.get_cube(direction_size, 0xff0000);
        scene.add(directionBox);
    }

    // ======== FPS ========
    var time = 0.0;
    var framecount = 0;
    function getFPS(deltaTime) {
        framecount++;
        time += deltaTime;
        debugHUD.innerHTML = 'use arrow keys to turn <br />';
        debugHUD.innerText += 'FPS: ' + (1.0 / (time / framecount)).toFixed(1);
        if (framecount > 100) {
            time = 0.0;
            framecount = 0;
        }
    }

    return app;
}(MODULE));