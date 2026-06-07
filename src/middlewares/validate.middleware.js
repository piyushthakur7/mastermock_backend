import { ApiError } from "../utils/ApiError.js";

export const validate = (schema) => async (req, res, next) => {
    try {
        const parsedBody = await schema.parseAsync(req.body);
        req.body = parsedBody;
        next();
    } catch (err) {
        const message = err.errors.map((e) => e.message).join(", ");
        next(new ApiError(400, message, err.errors));
    }
};
